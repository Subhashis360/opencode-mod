export * as CodeEmbeddings from "./embeddings.js"

import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CodeIndexer } from "./indexer.js"

// Optional meaning-based ranking: chunk vectors from any OpenAI-compatible /embeddings endpoint (Ollama, LM Studio,
// OpenAI, ...). Vectors are kept per chunk content and model, so only new or changed code is sent again.

export type Config = { baseURL: string; apiKey?: string; model: string }

const BATCH = 48
const MAX_CHARS = 2_400
const MAX_PER_RUN = 50_000

type Job = { running: boolean; done: number; error?: string; config: string }
const jobs = new Map<string, Job>()

const configKey = (config: Config) => `${config.baseURL}|${config.model}`

export async function embed(config: Config, inputs: readonly string[]): Promise<Float32Array[]> {
  const response = await fetch(`${config.baseURL.replace(/\/+$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, input: inputs }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok)
    throw new Error(`The embeddings endpoint answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const json = (await response.json()) as { data?: { embedding?: number[]; index?: number }[] }
  const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (data.length !== inputs.length || data.some((item) => !Array.isArray(item.embedding)))
    throw new Error("The embeddings endpoint returned an unexpected answer")
  return data.map((item) => normalize(Float32Array.from(item.embedding!)))
}

function normalize(vector: Float32Array) {
  let sum = 0
  for (const value of vector) sum += value * value
  const length = Math.sqrt(sum) || 1
  for (let index = 0; index < vector.length; index++) vector[index]! /= length
  return vector
}

const toBlob = (vector: Float32Array) => new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
const fromBlob = (blob: Uint8Array) => new Float32Array(blob.slice().buffer)

type Pending = { id: number; path: string; start: number; end: number; symbol: string; hash: string }

/** Embeds the chunks that have no vector for this model yet, in the background. */
export function fill(index: CodeIndexer.Index, config: Config) {
  const key = configKey(config)
  const current = jobs.get(index.root)
  if (current?.running && current.config === key) return
  const job: Job = { running: true, done: 0, config: key }
  jobs.set(index.root, job)

  void (async () => {
    const db = index.store.db
    const missing = db.query<Pending, [string, number]>(
      "SELECT c.id, c.path, c.start, c.end, c.symbol, c.hash FROM chunks c LEFT JOIN vectors v ON v.hash = c.hash AND v.model = ? WHERE v.hash IS NULL LIMIT ?",
    )
    const insert = db.query("INSERT OR REPLACE INTO vectors(hash, model, vector) VALUES (?, ?, ?)")
    try {
      while (job.done < MAX_PER_RUN && jobs.get(index.root) === job) {
        const batch = missing.all(config.model, BATCH)
        if (!batch.length) break
        const texts: string[] = []
        const cache = new Map<string, string[]>()
        for (const item of batch) {
          let lines = cache.get(item.path)
          if (!lines) {
            lines = (await readFile(path.join(index.root, item.path), "utf8").catch(() => "")).split(/\r?\n/)
            cache.set(item.path, lines)
          }
          const body = lines.slice(item.start - 1, item.end).join("\n")
          texts.push(`${item.path}${item.symbol ? ` ${item.symbol}` : ""}\n${body}`.slice(0, MAX_CHARS))
        }
        const vectors = await embed(config, texts)
        db.transaction(() => {
          batch.forEach((item, position) => insert.run(item.hash, config.model, toBlob(vectors[position]!)))
        })()
        job.done += batch.length
      }
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
    } finally {
      job.running = false
    }
  })()
}

export function stop(root: string) {
  jobs.delete(root)
}

export function status(index: CodeIndexer.Index, config: Config | undefined) {
  if (!config) return undefined
  const job = jobs.get(index.root)
  const row = index.store.db
    .query<{ embedded: number }, [string]>(
      "SELECT count(*) AS embedded FROM chunks c JOIN vectors v ON v.hash = c.hash AND v.model = ?",
    )
    .get(config.model)
  return {
    model: config.model,
    embedded: row?.embedded ?? 0,
    running: job?.running === true,
    ...(job?.error ? { error: job.error } : {}),
  }
}

/** The chunks closest in meaning to the query, best first. */
export async function nearest(index: CodeIndexer.Index, config: Config, query: string, limit: number) {
  const [target] = await embed(config, [query])
  const rows = index.store.db
    .query<{ id: number; vector: Uint8Array }, [string]>(
      "SELECT c.id AS id, v.vector AS vector FROM chunks c JOIN vectors v ON v.hash = c.hash AND v.model = ?",
    )
    .iterate(config.model)
  const scored: { id: number; score: number }[] = []
  for (const row of rows) {
    const vector = fromBlob(row.vector)
    if (vector.length !== target!.length) continue
    let score = 0
    for (let position = 0; position < vector.length; position++) score += vector[position]! * target![position]!
    scored.push({ id: row.id, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
