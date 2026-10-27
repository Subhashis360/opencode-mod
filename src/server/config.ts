export * as ModConfig from "./config.js"

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Path } from "./paths.js"

// The Mod settings edit the user's global config file, the same one OpenCode reads, so everything they change
// there also works without the mod. These are the top-level keys the Mod settings may write.
export const KEYS = [
  "agents",
  "commands",
  "permissions",
  "mcp",
  "default_agent",
  "instructions",
  "experimental",
  "provider",
  "disabled_providers",
  "websearch",
  "warming",
  "snapshots",
  "tool_output",
] as const
export type Key = (typeof KEYS)[number]

export function directory() {
  return Path.config
}

/** The global config file: the existing opencode.jsonc or opencode.json, else a new opencode.json. */
export function file(dir = directory()) {
  const jsonc = path.join(dir, "opencode.jsonc")
  if (existsSync(jsonc)) return jsonc
  return path.join(dir, "opencode.json")
}

export class ParseFailure extends Error {}

function parseObject(text: string, at: string): Record<string, unknown> {
  if (!text.trim()) return {}
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new ParseFailure(`${at} is not valid JSON: ${printParseErrorCode(errors[0]!.error)}`)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ParseFailure(`${at} is not a JSON object`)
  return value as Record<string, unknown>
}

async function text(target: string) {
  return readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return ""
    throw error
  })
}

export async function read(target = file()) {
  const contents = await text(target)
  const config = parseObject(contents, target)
  return {
    path: target,
    exists: contents !== "",
    values: Object.fromEntries(KEYS.filter((key) => key in config).map((key) => [key, config[key]])),
  }
}

/** Sets (or, with `undefined`, removes) the value at `segments`, keeping the file's comments and formatting. */
export function edit(contents: string, segments: readonly string[], value: unknown) {
  const base = contents.trim() ? contents : "{}\n"
  // Fails on a broken file instead of overwriting what the user wrote.
  parseObject(base, "the config file")
  const edits = modify(base, [...segments], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } })
  return applyEdits(base, edits)
}

export async function write(segments: readonly string[], value: unknown, target = file()) {
  const [key] = segments
  if (!KEYS.includes(key as Key)) throw new ParseFailure(`The Mod settings cannot change "${key}"`)
  const next = edit(await text(target), segments, value)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, next.endsWith("\n") ? next : `${next}\n`)
  return read(target)
}
