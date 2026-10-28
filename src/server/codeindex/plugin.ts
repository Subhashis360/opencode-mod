export * as CodeIndexPlugin from "./plugin.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Error as ToolError } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import type { ModSettings } from "../settings.js"
import DESCRIPTION from "./description.txt"
import { CodeEmbeddings } from "./embeddings.js"
import { CodeIndexer } from "./indexer.js"
import { CodeQuery } from "./query.js"

// The codebase tool, and the index behind it: built in the background when a project opens, then kept current.

export const Parameters = Schema.Struct({
  action: Schema.Literals(["search", "symbols", "references", "outline", "dependencies", "status"]),
  query: Schema.optional(Schema.String).annotate({ description: "search: what the code does, or a name. symbols: a name or part of one" }),
  symbol: Schema.optional(Schema.String).annotate({ description: "references: one identifier" }),
  file: Schema.optional(Schema.String).annotate({ description: "outline, dependencies: a file path relative to the project" }),
  path: Schema.optional(Schema.String).annotate({ description: "Only files whose path contains this" }),
  kind: Schema.optional(Schema.String).annotate({ description: "symbols: only this kind of declaration" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "How many results; search defaults to 8 (max 30)" }),
  full: Schema.optional(Schema.Boolean).annotate({ description: "search: show whole chunks instead of their first lines" }),
})

export type Params = Schema.Schema.Type<typeof Parameters>

/** The embeddings settings when meaning-based ranking is on and filled in. */
export function embeddingsOf(settings: ModSettings.CodeIndex): CodeEmbeddings.Config | undefined {
  const value = settings.embeddings
  if (!value.enabled || !value.baseURL.trim() || !value.model.trim()) return undefined
  return { baseURL: value.baseURL.trim(), model: value.model.trim(), ...(value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}) }
}

const need = (value: string | undefined, field: string, action: string) => {
  if (!value?.trim()) throw new Error(`${action} needs ${field}`)
  return value
}

export async function act(params: Params, directory: string, settings: ModSettings.CodeIndex) {
  const index = start(directory, settings)
  await index.ready()
  const embeddings = embeddingsOf(settings)

  switch (params.action) {
    case "search":
      return CodeQuery.search(
        index,
        {
          query: need(params.query, "query", "search"),
          ...(params.path ? { path: params.path } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
          ...(params.full ? { full: true } : {}),
        },
        embeddings,
      )
    case "symbols":
      return CodeQuery.symbols(index, {
        query: need(params.query ?? params.symbol, "query", "symbols"),
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.path ? { path: params.path } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      })
    case "references":
      return CodeQuery.references(index, {
        symbol: need(params.symbol ?? params.query, "symbol", "references"),
        ...(params.path ? { path: params.path } : {}),
      })
    case "outline":
      return CodeQuery.outline(index, { file: need(params.file, "file", "outline") })
    case "dependencies":
      return CodeQuery.dependencies(index, { file: need(params.file, "file", "dependencies") })
    case "status": {
      const status = index.status()
      const meaning = CodeEmbeddings.status(index, embeddings)
      return [
        `${status.root}: ${status.files} files, ${status.symbols} declarations, ${status.chunks} chunks.`,
        status.built ? `Updated ${new Date(status.built).toLocaleString()}.` : "",
        meaning ? `Meaning search: ${meaning.embedded}/${status.chunks} chunks embedded with ${meaning.model}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    }
  }
}

/** Indexes a project folder in the background and follows its changes; embeds new chunks when meaning search is on. */
export function start(directory: string, settings: ModSettings.CodeIndex) {
  const index = CodeIndexer.get(directory)
  const embeddings = embeddingsOf(settings)
  index.onChange = embeddings ? () => CodeEmbeddings.fill(index, embeddings) : undefined
  if (!started.has(index.root)) {
    started.add(index.root)
    index.watch()
    void index
      .refresh()
      .then(() => index.onChange?.())
      .catch(() => undefined)
  }
  return index
}

const started = new Set<string>()

/** Follows a settings change: off closes every index; on with meaning search embeds what is missing. */
export function configure(settings: ModSettings.CodeIndex) {
  if (!settings.enabled) return stopAll()
  const embeddings = embeddingsOf(settings)
  for (const index of CodeIndexer.all()) {
    if (!embeddings) CodeEmbeddings.stop(index.root)
    index.onChange = embeddings ? () => CodeEmbeddings.fill(index, embeddings) : undefined
    index.onChange?.()
  }
}

/** Stops every index's watching and embedding, for when the feature is turned off. */
export function stopAll() {
  for (const index of CodeIndexer.all()) CodeEmbeddings.stop(index.root)
  CodeIndexer.closeAll()
  started.clear()
}

/** Rebuilds a project's index from scratch. */
export async function rebuild(root: string, settings: ModSettings.CodeIndex) {
  const index = start(root, settings)
  await index.refresh(true)
  index.onChange?.()
}

/** Status of the indexes this process holds, for the Mod settings. */
export function statuses(settings: ModSettings.CodeIndex) {
  const embeddings = embeddingsOf(settings)
  return CodeIndexer.all().map((index) => {
    const meaning = CodeEmbeddings.status(index, embeddings)
    return { ...index.status(), ...(meaning ? { embeddings: meaning } : {}) }
  })
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Adds the codebase tool while `settings().enabled`; `ctx.tool.reload()` after a change adds or removes it. */
export const register = Effect.fn("CodeIndexPlugin.register")(function* (
  ctx: Pick<Context, "tool" | "location">,
  settings: () => ModSettings.CodeIndex,
) {
  const directory = ctx.location.directory

  // Built a moment after the project opens, so it never slows the first prompt.
  if (settings().enabled)
    setTimeout(() => {
      if (settings().enabled) start(directory, settings())
    }, 3_000)

  yield* ctx.tool
    .transform((editor) => {
      if (!settings().enabled) return
      editor.add({
        name: "codebase",
        description: DESCRIPTION,
        input: Parameters,
        options: { permission: "codebase", codemode: false },
        execute: (input) =>
          Effect.tryPromise({
            try: () => act(input, directory, settings()),
            catch: (error) => new ToolError({ message: message(error), error }),
          }).pipe(Effect.map((text) => ({ content: text, metadata: { title: `codebase ${input.action}` } }))),
      })
    })
    .pipe(Effect.orDie)
})
