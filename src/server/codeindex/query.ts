export * as CodeQuery from "./query.js"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { CodeEmbeddings } from "./embeddings.js"
import type { CodeIndexer } from "./indexer.js"
import type { CodeStore } from "./store.js"
import { CodeTokens } from "./tokens.js"

// The questions the codebase tool answers from the index, written for the model: short, with file:line references it
// can open with the read tool.

const SNIPPET = 14
const MAX_REFERENCES = 150

const lineCache = async (root: string) => {
  const cache = new Map<string, string[]>()
  return async (file: string) => {
    let lines = cache.get(file)
    if (!lines) {
      lines = (await readFile(path.join(root, file), "utf8").catch(() => "")).split(/\r?\n/)
      cache.set(file, lines)
    }
    return lines
  }
}

const numbered = (lines: readonly string[], start: number, end: number, max: number) => {
  const shown = lines.slice(start - 1, Math.min(end, start - 1 + max))
  const out = shown.map((line, index) => `${String(start + index).padStart(5)}  ${line.length > 220 ? `${line.slice(0, 220)}…` : line}`)
  if (end - start + 1 > max) out.push(`        … ${end - start + 1 - max} more lines`)
  return out.join("\n")
}

type Hit = Pick<CodeStore.ChunkRow, "id" | "path" | "start" | "end" | "symbol">

const pathFilter = (filter: string | undefined) => (file: string) =>
  !filter || file.toLowerCase().includes(filter.replace(/\\/g, "/").toLowerCase())

/** Ranked code for a description or a name: full-text with code-aware words, fused with meaning when available. */
export async function search(
  index: CodeIndexer.Index,
  input: { query: string; path?: string; limit?: number; full?: boolean },
  embeddings: CodeEmbeddings.Config | undefined,
) {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30)
  const db = index.store.db
  const keep = pathFilter(input.path)
  const ranks = new Map<number, number>()
  const add = (ids: readonly number[], weight: number) =>
    ids.forEach((id, rank) => ranks.set(id, (ranks.get(id) ?? 0) + weight / (60 + rank)))

  // Exact names first: a query that is an identifier finds its declaration.
  const exact = input.query.trim()
  if (/^[A-Za-z_$][\w$.:]*$/.test(exact)) {
    const name = exact.split(/[.:]+/).pop()!.toLowerCase()
    const declared = db
      .query<{ id: number }, [string]>(
        "SELECT c.id AS id FROM symbols s JOIN chunks c ON c.path = s.path AND c.start <= s.line AND c.end >= s.line WHERE s.lname = ? LIMIT 20",
      )
      .all(name)
      .map((row) => row.id)
    add(declared, 3)
  }

  const fullText = db.query<{ id: number; path: string; lang: string }, [string]>(
    "SELECT c.id AS id, c.path AS path, f.lang AS lang FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid JOIN files f ON f.path = c.path WHERE chunk_fts MATCH ? ORDER BY bm25(chunk_fts, 6.0, 2.0, 1.0) LIMIT 300",
  )
  // Code before prose and data files, unless the question is about docs.
  const docs = /\b(readme|docs?|documentation|guide|markdown|changelog|json|yaml)\b/i.test(input.query)
  const rank = (match: string | undefined, weight: number) => {
    if (!match) return
    const rows = fullText.all(match).filter((row) => keep(row.path))
    const code = rows.filter((row) => docs || (row.lang !== "markdown" && row.lang !== "text"))
    const rest = rows.filter((row) => !code.includes(row))
    add(code.map((row) => row.id), weight)
    add(rest.map((row) => row.id), weight * 0.4)
  }
  rank(CodeTokens.query(input.query), 1)
  rank(CodeTokens.query(input.query, true), 0.35)

  let semantic = ""
  if (embeddings) {
    try {
      const near = await CodeEmbeddings.nearest(index, embeddings, input.query, 300)
      add(near.map((item) => item.id), 1.2)
      semantic = near.length ? " (ranked by words and meaning)" : ""
    } catch (error) {
      semantic = ` (meaning search failed: ${error instanceof Error ? error.message : String(error)})`
    }
  }

  const byId = db.query<Hit, [number]>("SELECT id, path, start, end, symbol FROM chunks WHERE id = ?")
  const perFile = new Map<string, number>()
  const hits: Hit[] = []
  for (const [id] of [...ranks.entries()].sort((a, b) => b[1] - a[1])) {
    const hit = byId.get(id)
    if (!hit || !keep(hit.path)) continue
    const count = perFile.get(hit.path) ?? 0
    if (count >= 3) continue
    perFile.set(hit.path, count + 1)
    hits.push(hit)
    if (hits.length >= limit) break
  }

  if (!hits.length) return `No code matched "${input.query}". Try other words, a name, or the references action.`
  const lines = await lineCache(index.root)
  const blocks = await Promise.all(
    hits.map(async (hit, position) => {
      const text = await lines(hit.path)
      const title = `${position + 1}. ${hit.path}:${hit.start}-${hit.end}${hit.symbol ? `  ${hit.symbol}` : ""}`
      return `${title}\n${numbered(text, hit.start, hit.end, input.full ? 120 : SNIPPET)}`
    }),
  )
  return `${hits.length} results for "${input.query}"${semantic}:\n\n${blocks.join("\n\n")}`
}

/** Declarations by name: exact, then prefix, then containing. */
export function symbols(index: CodeIndexer.Index, input: { query: string; kind?: string; path?: string; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 200)
  const name = input.query.trim().toLowerCase()
  if (!name) return "Give a name, or part of one."
  const keep = pathFilter(input.path)
  const rows = index.store.db
    .query<CodeStore.SymbolRow & { rank: number }, [string, string, string, string, string]>(
      `SELECT path, name, kind, line, end, parent, signature,
         CASE WHEN lname = ? THEN 0 WHEN lname LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END AS rank
       FROM symbols WHERE lname LIKE ? ESCAPE '\\' AND (? = '' OR kind = ?)
       ORDER BY rank, length(name), path LIMIT 1000`,
    )
    .all(name, `${escapeLike(name)}%`, `%${escapeLike(name)}%`, input.kind ?? "", input.kind ?? "")
    .filter((row) => keep(row.path))
    .slice(0, limit)
  if (!rows.length) return `No declaration named like "${input.query}". Try the search action.`
  return rows
    .map((row) => `${row.path}:${row.line}-${row.end}  ${row.kind} ${row.parent ? `${row.parent}.` : ""}${row.name}\n        ${row.signature}`)
    .join("\n")
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Where a name is declared, imported, called and used, each use with the declaration it sits in: who calls what. */
export async function references(index: CodeIndexer.Index, input: { symbol: string; path?: string }) {
  const symbol = input.symbol.trim().split(/[.:]+/).pop() ?? ""
  if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) return "Give one identifier, such as fetchUser or UserService."
  const db = index.store.db
  const keep = pathFilter(input.path)
  const lower = symbol.toLowerCase()
  const files = db
    .query<{ path: string }, [string]>(
      "SELECT DISTINCT c.path AS path FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid WHERE chunk_fts MATCH ? LIMIT 2000",
    )
    .all(`body:"${lower.replace(/\$/g, "")}" OR name:"${lower.replace(/\$/g, "")}"`)
    .map((row) => row.path)
    .filter(keep)

  const declared = db
    .query<CodeStore.SymbolRow, [string]>("SELECT path, name, kind, line, end, parent, signature FROM symbols WHERE name = ?")
    .all(symbol)
  const enclosing = db.query<{ name: string; parent: string; kind: string }, [string, number, number]>(
    "SELECT name, parent, kind FROM symbols WHERE path = ? AND line <= ? AND end >= ? ORDER BY line DESC LIMIT 1",
  )
  const pattern = new RegExp(`(?<![\\w$])${escapeRegex(symbol)}(?![\\w$])`)
  const call = new RegExp(`(?:new\\s+)?${escapeRegex(symbol)}\\s*(?:<[^>()]*>)?\\s*\\(`)
  const importLine = /^\s*(import|from|export\s.*\sfrom|use|using|#\s*include|require|const .*require\()/

  const lines = await lineCache(index.root)
  const groups = { definition: [] as string[], import: [] as string[], call: [] as string[], reference: [] as string[] }
  let total = 0
  for (const file of files) {
    const text = await lines(file)
    for (let position = 0; position < text.length; position++) {
      const line = text[position]!
      if (!pattern.test(line)) continue
      total++
      const number = position + 1
      const isDefinition = declared.some((item) => item.path === file && item.line === number)
      const kind = isDefinition ? "definition" : importLine.test(line) ? "import" : call.test(line) ? "call" : "reference"
      const count = groups.definition.length + groups.import.length + groups.call.length + groups.reference.length
      if (count >= MAX_REFERENCES) continue
      const owner = isDefinition ? undefined : enclosing.get(file, number, number)
      const where = owner ? `  in ${owner.kind} ${owner.parent ? `${owner.parent}.` : ""}${owner.name}` : ""
      groups[kind].push(`${file}:${number}${where}\n        ${line.trim().slice(0, 200)}`)
    }
  }

  if (!total) return `"${symbol}" does not appear in the indexed code.`
  const section = (title: string, items: string[]) => (items.length ? `${title} (${items.length}):\n${items.join("\n")}` : "")
  const callers = [...new Set(groups.call.map((item) => item.split("  in ")[1]?.split("\n")[0]).filter(Boolean))]
  return [
    `"${symbol}": ${total} occurrences in ${files.length} files${total > MAX_REFERENCES ? ` (first ${MAX_REFERENCES} shown)` : ""}.`,
    callers.length ? `Called from: ${callers.slice(0, 40).join(", ")}` : "",
    section("Definitions", groups.definition),
    section("Calls", groups.call),
    section("Imports", groups.import),
    section("Other uses", groups.reference),
  ]
    .filter(Boolean)
    .join("\n\n")
}

const normal = (file: string) => file.replace(/\\/g, "/").replace(/^\.\//, "")

/** A file's declarations as a tree. */
export function outline(index: CodeIndexer.Index, input: { file: string }) {
  const file = normal(input.file)
  const rows = index.store.db
    .query<CodeStore.SymbolRow, [string]>(
      "SELECT path, name, kind, line, end, parent, signature FROM symbols WHERE path = ? ORDER BY line",
    )
    .all(relative(index, file))
  if (!rows.length) return `No declarations indexed for ${file}. Check the path (relative to ${index.root}).`
  const depth = new Map<string, number>()
  return rows
    .map((row) => {
      const level = row.parent ? (depth.get(row.parent) ?? 0) + 1 : 0
      depth.set(row.name, level)
      return `${"  ".repeat(level)}${row.line}-${row.end}  ${row.kind} ${row.name}`
    })
    .join("\n")
}

const relative = (index: CodeIndexer.Index, file: string) =>
  path.isAbsolute(file) ? normal(path.relative(index.root, file)) : normal(file)

const CANDIDATE_SUFFIXES = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".py", ".go", ".rs", ".rb", ".php", ".lua", ".h", ".hpp",
  "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/__init__.py", "/mod.rs",
]

/** What a written import points to among the indexed files, when it is a file of this project. */
function resolve(spec: string, from: string, known: (file: string) => boolean) {
  const dir = path.posix.dirname(from)
  const bases: string[] = []
  if (spec.startsWith(".")) {
    // Python relative modules write dots for folders: ..pkg.mod
    const python = /^\.+[\w.]*$/.test(spec) && !spec.includes("/") && from.endsWith(".py")
    if (python) {
      const ups = spec.match(/^\.+/)![0].length - 1
      const rest = spec.slice(ups + 1).replace(/\./g, "/")
      bases.push(path.posix.join(dir, "../".repeat(ups), rest))
    } else bases.push(path.posix.join(dir, spec.replace(/\.(js|mjs|cjs|jsx)$/, "")), path.posix.join(dir, spec))
  } else {
    bases.push(spec.replace(/\./g, "/"), spec, spec.replace(/::/g, "/"), path.posix.join(dir, spec))
  }
  for (const base of bases)
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = normal(path.posix.normalize(base + suffix))
      if (!candidate.startsWith("..") && known(candidate)) return candidate
    }
  return undefined
}

/** What a file imports, and which files import it. */
export function dependencies(index: CodeIndexer.Index, input: { file: string }) {
  const db = index.store.db
  const file = relative(index, normal(input.file))
  const has = db.query<{ path: string }, [string]>("SELECT path FROM files WHERE path = ?")
  if (!has.get(file)) return `${file} is not indexed. Paths are relative to ${index.root}.`
  const known = (candidate: string) => !!has.get(candidate)

  const own = db.query<{ spec: string }, [string]>("SELECT spec FROM imports WHERE path = ?").all(file)
  const imports = own.map((row) => {
    const target = resolve(row.spec, file, known)
    return target ? `${row.spec} → ${target}` : `${row.spec} (external)`
  })

  // Importers: imports naming this file's stem, kept when they resolve to this file.
  const stem = path.posix.basename(file).replace(/\.[^.]+$/, "")
  const name = stem === "index" || stem === "__init__" || stem === "mod" ? path.posix.basename(path.posix.dirname(file)) : stem
  const candidates = db
    .query<{ path: string; spec: string }, [string]>("SELECT path, spec FROM imports WHERE spec LIKE ? ESCAPE '\\'")
    .all(`%${escapeLike(name)}%`)
  const importers = [
    ...new Set(
      candidates
        .filter((row) => row.path !== file && resolve(row.spec, row.path, known) === file)
        .map((row) => row.path),
    ),
  ]

  return [
    `${file}`,
    `Imports (${imports.length}):${imports.length ? `\n  ${imports.join("\n  ")}` : " none"}`,
    `Imported by (${importers.length}):${importers.length ? `\n  ${importers.sort().join("\n  ")}` : " none found"}`,
  ].join("\n")
}
