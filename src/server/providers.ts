export * as ModProviders from "./providers.js"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { Path } from "./paths.js"

// OpenCode Mod: the Providers tab lists a custom provider's models from its own API, so they need not be typed in.
// Fetched here, in the server, because a window's fetch would be stopped by the provider's CORS rules.

export type Model = { id: string; name?: string }

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

/** Reads the model list out of the common response shapes: OpenAI's, Anthropic's, Google's and Ollama's. */
export function parse(body: unknown): Model[] {
  if (!body || typeof body !== "object") return []
  const record = body as Record<string, unknown>
  const items = Array.isArray(body) ? body : Array.isArray(record.data) ? record.data : record.models
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  return items.flatMap((item): Model[] => {
    if (typeof item === "string") item = { id: item }
    if (!item || typeof item !== "object") return []
    const entry = item as Record<string, unknown>
    // Google lists "models/gemini-…"; the API is called with the bare id.
    const id = text(entry.id) ?? text(entry.model) ?? text(entry.name)?.replace(/^models\//, "")
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name = text(entry.display_name) ?? text(entry.displayName) ?? text(entry.name)
    return [{ id, ...(name && name !== id && !name.startsWith("models/") ? { name } : {}) }]
  })
}

/** The API key OpenCode saved when the user connected `provider`, if any. */
async function savedKey(provider: string) {
  const auth = await readFile(path.join(Path.data, "auth.json"), "utf8")
    .then((body) => JSON.parse(body) as Record<string, { type?: string; key?: unknown }>)
    .catch(() => undefined)
  const entry = auth?.[provider]
  return entry?.type === "api" && typeof entry.key === "string" ? entry.key : undefined
}

export async function fetchModels(input: {
  baseURL: string
  provider?: string
  apiKey?: string
  headers?: Record<string, string>
}) {
  // The URL OpenCode calls for chat may include the endpoint path; the model list sits beside it.
  const base = input.baseURL
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|completions|responses|messages)$/, "")
  if (!/^https?:\/\//i.test(base)) throw new Error("The base URL must start with http:// or https://")

  const apiKey = input.apiKey?.trim() || (input.provider ? await savedKey(input.provider) : undefined)
  const headers: Record<string, string> = { accept: "application/json", ...input.headers }
  if (apiKey) {
    headers.authorization ??= `Bearer ${apiKey}`
    headers["x-api-key"] ??= apiKey
    headers["anthropic-version"] ??= "2023-06-01"
  }

  // OpenAI-compatible APIs answer /models; Ollama's own API answers /api/tags.
  const urls = [`${base}/models`, ...(/\/v1$/.test(base) ? [] : [`${base}/v1/models`]), `${base.replace(/\/v1$/, "")}/api/tags`]
  let last = "No models found"
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
      if (!response.ok) {
        last = `${url} answered ${response.status} ${response.statusText}`.trim()
        if (response.status === 401 || response.status === 403) break
        continue
      }
      const models = parse(await response.json())
      if (models.length) return models.toSorted((a, b) => a.id.localeCompare(b.id))
      last = `${url} listed no models`
    } catch (error) {
      last = `${url}: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  throw new Error(last)
}
