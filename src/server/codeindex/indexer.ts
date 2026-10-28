export * as CodeIndexer from "./indexer.js"

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, watch, type FSWatcher } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { CodeLanguages } from "./languages.js"
import { CodeStore } from "./store.js"
import { CodeTokens } from "./tokens.js"

// Keeps one project folder's index current: a full scan the first time, then only what changed, from file-system
// events and from a cheap size-and-time check before a search.

const MAX_FILES = 60_000
const MAX_BYTES = 1_000_000
const CHUNK_LINES = 60
const MAX_CHUNK = 90
const RESCAN_MS = 30_000
const BATCH = 200

/** Folders that hold dependencies, builds and caches, skipped even when git tracks them. */
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  "coverage", "target", "vendor", "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache", ".pytest_cache", "bin",
  "obj", ".gradle", ".idea", ".vscode", "Pods", "DerivedData", ".dart_tool", ".expo", "bower_components", "jspm_packages",
  ".parcel-cache", ".output", "storybook-static", "tmp", ".terraform",
])

const IGNORED_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|\.d\.ts\.map$|\.snap$/

const skipped = (file: string) => file.split("/").some((part) => IGNORED_DIRS.has(part)) || IGNORED_FILES.test(file)

export type Status = {
  root: string
  files: number
  chunks: number
  symbols: number
  building: boolean
  done: number
  total: number
  built?: number
  error?: string
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex")

function gitFiles(root: string) {
  return new Promise<string[] | undefined>((resolve) =>
    execFile(
      "git",
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { cwd: root, windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 60_000 },
      (error, stdout) => resolve(error ? undefined : String(stdout).split("\0").filter(Boolean)),
    ),
  )
}

async function walk(root: string) {
  const found: string[] = []
  const visit = async (dir: string) => {
    if (found.length >= MAX_FILES) return
    const entries = await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) await visit(rel)
      } else if (entry.isFile()) found.push(rel)
      if (found.length >= MAX_FILES) return
    }
  }
  await visit("")
  return found
}

/** The project's indexable files, relative with forward slashes: git's list when it is a repository, else a walk. */
async function list(root: string) {
  const files = (existsSync(path.join(root, ".git")) ? await gitFiles(root) : undefined) ?? (await walk(root))
  return files
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !skipped(file) && CodeLanguages.detect(file))
    .slice(0, MAX_FILES)
}

type Chunk = CodeStore.Indexed["chunks"][number]

/** Splits a file at its declarations; long stretches become windows, tiny ones join the next. */
function chunk(file: string, lines: readonly string[], declarations: readonly CodeLanguages.Declaration[]) {
  const outer = Math.min(...declarations.map((item) => item.indent), Infinity)
  // Boundaries at the outermost declarations, and at methods of a class when the class is long.
  const starts = declarations
    .filter((item) => item.indent <= outer + 4)
    .map((item) => item.line)
    .filter((line, index, all) => all.indexOf(line) === index)
  if (starts[0] !== 1) starts.unshift(1)

  const ranges: { start: number; end: number }[] = []
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]!
    const end = (starts[index + 1] ?? lines.length + 1) - 1
    if (end < start) continue
    const last = ranges.at(-1)
    if (last && last.end - last.start < 4) last.end = end
    else ranges.push({ start, end })
  }

  const pieces: { start: number; end: number }[] = []
  for (const range of ranges) {
    if (range.end - range.start + 1 <= MAX_CHUNK) {
      pieces.push(range)
      continue
    }
    for (let start = range.start; start <= range.end; start += CHUNK_LINES - 10)
      pieces.push({ start, end: Math.min(range.end, start + CHUNK_LINES - 1) })
  }

  const pathWords = CodeTokens.path(file)
  return pieces
    .map((piece): Chunk | undefined => {
      const text = lines.slice(piece.start - 1, piece.end).join("\n")
      if (!text.trim()) return undefined
      const inside = declarations.filter((item) => item.line >= piece.start && item.line <= piece.end)
      const owner = [...declarations].reverse().find((item) => item.line <= piece.start)
      const names = inside.map((item) => item.name)
      return {
        start: piece.start,
        end: piece.end,
        symbol: inside[0]?.name ?? owner?.name ?? "",
        hash: sha1(`${file}\n${text}`),
        name: CodeTokens.index(names.join(" ")),
        pathWords,
        body: CodeTokens.index(text),
      }
    })
    .filter((item): item is Chunk => !!item)
}

/** Each declaration with its line range and the declaration it sits in. */
function symbols(lang: string, lines: readonly string[], declarations: readonly CodeLanguages.Declaration[]) {
  const ends = declarations.map((_, index) => CodeLanguages.endOf(lang, lines, declarations, index))
  return declarations.map((item, index) => {
    // The innermost earlier declaration whose range holds this one.
    let parent = ""
    for (let other = index - 1; other >= 0; other--) {
      if (ends[other]! >= item.line && declarations[other]!.line < item.line) {
        parent = declarations[other]!.name
        break
      }
    }
    return {
      name: item.name,
      kind: item.kind,
      line: item.line,
      end: ends[index]!,
      parent,
      signature: (lines[item.line - 1] ?? "").trim().slice(0, 200),
    }
  })
}

async function read(root: string, file: string): Promise<CodeStore.Indexed | undefined> {
  const full = path.join(root, file)
  const info = await stat(full).catch(() => undefined)
  if (!info?.isFile() || info.size > MAX_BYTES) return undefined
  const text = await readFile(full, "utf8").catch(() => undefined)
  if (text === undefined || text.slice(0, 8000).includes("\0")) return undefined
  const lines = text.split(/\r?\n/)
  // Minified or generated one-liners say nothing a search can use.
  if (lines.length < 3 && text.length > 5000) return undefined
  const lang = CodeLanguages.detect(file)!
  const declarations = CodeLanguages.declarations(lang, lines)
  return {
    file: { path: file, mtime: info.mtimeMs, size: info.size, hash: sha1(text), lang, lines: lines.length },
    chunks: chunk(file, lines, declarations),
    symbols: symbols(lang, lines, declarations),
    imports: CodeLanguages.imports(lang, lines),
  }
}

const pause = () => new Promise((resolve) => setImmediate(resolve))

export class Index {
  readonly store: CodeStore.Store
  private refreshing: Promise<void> | undefined
  private scanned = 0
  private dirty = new Set<string>()
  private watcher: FSWatcher | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private progress = { done: 0, total: 0 }
  private error: string | undefined
  /** Runs after each change to the index, such as the embedding job. */
  onChange: (() => void) | undefined

  constructor(readonly root: string) {
    this.store = CodeStore.open(root)
  }

  status(): Status {
    const counts = this.store.counts()
    const built = Number(this.store.meta("built"))
    return {
      root: this.root,
      ...counts,
      building: !!this.refreshing,
      ...this.progress,
      ...(built ? { built } : {}),
      ...(this.error ? { error: this.error } : {}),
    }
  }

  /** Brings the index up to date: everything on the first call, then what changed. */
  refresh(full = false): Promise<void> {
    // A rebuild asked for during other work runs after it; any other refresh joins the work in progress.
    if (this.refreshing && full) return this.refreshing.catch(() => undefined).then(() => this.refresh(true))
    this.refreshing ??= this.scan(full).finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  /** Waits for a current index before a query. A recent scan with no change events is trusted as is. */
  async ready() {
    if (this.refreshing) return this.refreshing
    if (this.dirty.size) return this.flush()
    if (Date.now() - this.scanned > RESCAN_MS) return this.refresh()
  }

  private async scan(full: boolean) {
    this.error = undefined
    try {
      const files = await list(this.root)
      const known = new Map(this.store.statements.files.all().map((row) => [row.path, row]))
      const present = new Set(files)
      const removed = [...known.keys()].filter((file) => !present.has(file))
      const changed: string[] = []

      for (const [index, file] of files.entries()) {
        if (index % 500 === 0) await pause()
        const row = known.get(file)
        if (full || !row) {
          changed.push(file)
          continue
        }
        const info = await stat(path.join(this.root, file)).catch(() => undefined)
        if (!info) removed.push(file)
        else if (info.mtimeMs !== row.mtime || info.size !== row.size) changed.push(file)
      }

      await this.index(changed, removed)
      this.scanned = Date.now()
      this.store.setMeta("built", String(this.scanned))
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.progress = { done: 0, total: 0 }
    }
  }

  private async index(files: readonly string[], removed: readonly string[]) {
    this.progress = { done: 0, total: files.length }
    if (removed.length) this.store.apply([], removed)
    for (let offset = 0; offset < files.length; offset += BATCH) {
      const batch = files.slice(offset, offset + BATCH)
      const entries: CodeStore.Indexed[] = []
      const gone: string[] = []
      for (const file of batch) {
        const entry = await read(this.root, file)
        if (entry) entries.push(entry)
        else gone.push(file)
      }
      this.store.apply(entries, gone)
      this.progress = { done: Math.min(files.length, offset + BATCH), total: files.length }
      await pause()
    }
    if (files.length || removed.length) {
      this.store.pruneVectors()
      this.onChange?.()
    }
  }

  /** Re-reads the files change events named. */
  private flush(): Promise<void> {
    // Files changed during other work are read once it ends, so none is dropped.
    if (this.refreshing)
      return this.refreshing.catch(() => undefined).then(() => (this.dirty.size ? this.flush() : undefined))
    const files = [...this.dirty]
    this.dirty.clear()
    this.refreshing = (async () => {
      const keep: string[] = []
      const removed: string[] = []
      for (const file of files) {
        if (skipped(file) || !CodeLanguages.detect(file)) continue
        if (existsSync(path.join(this.root, file))) keep.push(file)
        else removed.push(file)
      }
      await this.index(keep, removed)
    })().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  /** Follows file changes; where the platform has no recursive watching, the check before each search covers it. */
  watch() {
    if (this.watcher) return
    try {
      this.watcher = watch(this.root, { recursive: true }, (_, name) => {
        if (!name) return
        const file = String(name).replace(/\\/g, "/")
        if (skipped(file) || !CodeLanguages.detect(file)) return
        this.dirty.add(file)
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.flush().catch(() => undefined), 1_500)
      })
      this.watcher.on("error", () => this.unwatch())
    } catch {
      this.watcher = undefined
    }
  }

  unwatch() {
    clearTimeout(this.timer)
    this.watcher?.close()
    this.watcher = undefined
  }

  close() {
    this.unwatch()
    this.store.close()
  }
}

const indexes = new Map<string, Index>()

const key = (root: string) => path.resolve(root).toLowerCase()

/** The index of a project folder, shared by every session in this process. */
export function get(root: string) {
  const id = key(root)
  let found = indexes.get(id)
  if (!found) {
    found = new Index(path.resolve(root))
    indexes.set(id, found)
  }
  return found
}

export function all() {
  return [...indexes.values()]
}

/** Stops watching and closes every index, for when the feature is turned off. */
export function closeAll() {
  for (const index of indexes.values()) index.close()
  indexes.clear()
}
