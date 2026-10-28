export * as CodeStore from "./store.js"

import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { Path } from "../paths.js"

// One SQLite file per project folder, under OpenCode's data folder: files, their chunks (with a full-text index),
// declared symbols, imports, and the optional embedding vectors keyed by chunk content.

/** Raised whenever what is indexed or how changes, so old indexes are rebuilt. */
const VERSION = "5"

export type FileRow = { path: string; mtime: number; size: number; hash: string; lang: string; lines: number }
export type ChunkRow = { id: number; path: string; start: number; end: number; symbol: string; hash: string }
export type SymbolRow = {
  path: string
  name: string
  kind: string
  line: number
  end: number
  parent: string
  signature: string
}

export const folder = () => path.join(Path.data, "opencode-mod", "code-index")

export const fileFor = (root: string) =>
  path.join(folder(), `${createHash("sha1").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16)}.sqlite`)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, mtime REAL, size INTEGER, hash TEXT, lang TEXT, lines INTEGER);
CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, path TEXT, start INTEGER, end INTEGER, symbol TEXT, hash TEXT);
CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(name, path, body, tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS symbols(path TEXT, name TEXT, lname TEXT, kind TEXT, line INTEGER, end INTEGER, parent TEXT, signature TEXT);
CREATE INDEX IF NOT EXISTS symbols_lname ON symbols(lname);
CREATE INDEX IF NOT EXISTS symbols_path ON symbols(path);
CREATE TABLE IF NOT EXISTS imports(path TEXT, spec TEXT);
CREATE INDEX IF NOT EXISTS imports_path ON imports(path);
CREATE TABLE IF NOT EXISTS vectors(hash TEXT, model TEXT, vector BLOB, PRIMARY KEY(hash, model));
`

export type Indexed = {
  file: FileRow
  chunks: { start: number; end: number; symbol: string; hash: string; name: string; pathWords: string; body: string }[]
  symbols: Omit<SymbolRow, "path">[]
  imports: string[]
}

export function open(root: string) {
  mkdirSync(folder(), { recursive: true })
  const db = new Database(fileFor(root), { create: true })
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA synchronous=NORMAL;")
  db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);")
  const version = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'version'").get()?.value
  if (version !== VERSION) {
    // An index from another version of the mod is rebuilt rather than read wrongly.
    db.exec(
      "DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS chunk_fts; DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS imports; DROP TABLE IF EXISTS vectors;",
    )
  }
  db.exec(SCHEMA)
  db.query("INSERT OR REPLACE INTO meta(key, value) VALUES ('version', ?)").run(VERSION)
  db.query("INSERT OR REPLACE INTO meta(key, value) VALUES ('root', ?)").run(path.resolve(root))

  const statements = {
    files: db.query<FileRow, []>("SELECT * FROM files"),
    file: db.query<FileRow, [string]>("SELECT * FROM files WHERE path = ?"),
    chunkIds: db.query<{ id: number }, [string]>("SELECT id FROM chunks WHERE path = ?"),
    deleteFts: db.query("DELETE FROM chunk_fts WHERE rowid = ?"),
    deleteChunks: db.query("DELETE FROM chunks WHERE path = ?"),
    deleteSymbols: db.query("DELETE FROM symbols WHERE path = ?"),
    deleteImports: db.query("DELETE FROM imports WHERE path = ?"),
    deleteFile: db.query("DELETE FROM files WHERE path = ?"),
    insertFile: db.query("INSERT OR REPLACE INTO files(path, mtime, size, hash, lang, lines) VALUES (?, ?, ?, ?, ?, ?)"),
    insertChunk: db.query("INSERT INTO chunks(path, start, end, symbol, hash) VALUES (?, ?, ?, ?, ?)"),
    insertFts: db.query("INSERT INTO chunk_fts(rowid, name, path, body) VALUES (?, ?, ?, ?)"),
    insertSymbol: db.query(
      "INSERT INTO symbols(path, name, lname, kind, line, end, parent, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    insertImport: db.query("INSERT INTO imports(path, spec) VALUES (?, ?)"),
  }

  const forget = (file: string) => {
    for (const { id } of statements.chunkIds.all(file)) statements.deleteFts.run(id)
    statements.deleteChunks.run(file)
    statements.deleteSymbols.run(file)
    statements.deleteImports.run(file)
    statements.deleteFile.run(file)
  }

  /** Replaces the given files' entries and removes the others listed, in one transaction. */
  const apply = db.transaction((entries: readonly Indexed[], removed: readonly string[]) => {
    for (const file of removed) forget(file)
    for (const entry of entries) {
      forget(entry.file.path)
      const f = entry.file
      statements.insertFile.run(f.path, f.mtime, f.size, f.hash, f.lang, f.lines)
      for (const chunk of entry.chunks) {
        const result = statements.insertChunk.run(f.path, chunk.start, chunk.end, chunk.symbol, chunk.hash)
        statements.insertFts.run(Number(result.lastInsertRowid), chunk.name, chunk.pathWords, chunk.body)
      }
      for (const symbol of entry.symbols)
        statements.insertSymbol.run(
          f.path,
          symbol.name,
          symbol.name.toLowerCase(),
          symbol.kind,
          symbol.line,
          symbol.end,
          symbol.parent,
          symbol.signature,
        )
      for (const spec of entry.imports) statements.insertImport.run(f.path, spec)
    }
  })

  /** Keeps only the vectors some chunk still uses. */
  const pruneVectors = () => db.exec("DELETE FROM vectors WHERE hash NOT IN (SELECT hash FROM chunks)")

  const counts = () =>
    db
      .query<{ files: number; chunks: number; symbols: number }, []>(
        "SELECT (SELECT count(*) FROM files) AS files, (SELECT count(*) FROM chunks) AS chunks, (SELECT count(*) FROM symbols) AS symbols",
      )
      .get() ?? { files: 0, chunks: 0, symbols: 0 }

  const meta = (key: string) => db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value
  const setMeta = (key: string, value: string) =>
    db.query("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(key, value)

  return { db, statements, apply, pruneVectors, counts, meta, setMeta, close: () => db.close() }
}

export type Store = ReturnType<typeof open>
