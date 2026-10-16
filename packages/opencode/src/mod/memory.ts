import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { randomUUID } from "crypto"
import { mkdir, readFile, rename, writeFile } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"

// OpenCode Mod: auto memory. The agent saves short durable facts (about the user, or about one
// project) with the memory tool, and every session starts with them in its system prompt.

export type Entry = {
  id: string
  scope: "global" | "project"
  project?: string
  text: string
  created: number
  updated: number
}
type File = { enabled: boolean; entries: Entry[] }

const MAX_TEXT = 500
const PROMPT_BUDGET = 6_000

export const file = () => path.join(Global.Path.data, "memory.json")

const norm = (dir: string) => path.resolve(dir).toLowerCase()

let queue: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>) {
  const result = queue.then(fn, fn)
  queue = result.catch(() => {})
  return result
}

export async function load(): Promise<File> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as Partial<File>
    return { enabled: parsed.enabled !== false, entries: parsed.entries ?? [] }
  } catch {
    return { enabled: true, entries: [] }
  }
}

async function write(data: File) {
  await mkdir(path.dirname(file()), { recursive: true })
  const temp = `${file()}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2))
  await rename(temp, file())
}

const mutate = <T>(fn: (data: File) => T) =>
  locked(async () => {
    const data = await load()
    const result = fn(data)
    await write(data)
    return result
  })

/** Facts that apply in `directory`: every global one plus that project's. */
export async function relevant(directory: string) {
  const data = await load()
  const here = norm(directory)
  return data.entries.filter((entry) => entry.scope === "global" || (entry.project && norm(entry.project) === here))
}

export async function save(input: { id?: string; text: string; scope: Entry["scope"]; project?: string }) {
  const text = input.text.trim().replace(/\s+/g, " ")
  if (!text) throw new Error("A memory needs some text")
  if (text.length > MAX_TEXT) throw new Error(`Keep a memory under ${MAX_TEXT} characters`)
  if (input.scope === "project" && !input.project) throw new Error("A project memory needs its folder")
  return mutate((data) => {
    const now = Date.now()
    const existing = input.id ? data.entries.find((entry) => entry.id === input.id) : undefined
    if (input.id && !existing) throw new Error("Memory not found")
    if (existing) {
      Object.assign(existing, {
        text,
        scope: input.scope,
        project: input.scope === "project" ? input.project : undefined,
        updated: now,
      })
      return existing
    }
    const entry: Entry = {
      id: randomUUID().slice(0, 8),
      scope: input.scope,
      ...(input.scope === "project" && { project: input.project }),
      text,
      created: now,
      updated: now,
    }
    data.entries.push(entry)
    return entry
  })
}

export const remove = (id: string) =>
  mutate((data) => {
    const before = data.entries.length
    data.entries = data.entries.filter((entry) => entry.id !== id)
    return data.entries.length < before
  })

export const setEnabled = (enabled: boolean) => mutate((data) => void (data.enabled = enabled))

export function prompt(entries: Entry[]) {
  if (entries.length === 0) return undefined
  const lines: string[] = []
  let used = 0
  // Newest first, so the budget keeps the most recent facts.
  for (const entry of entries.toSorted((a, b) => b.updated - a.updated)) {
    const line = `- [${entry.id}${entry.scope === "project" ? ", this project" : ""}] ${entry.text}`
    if (used + line.length > PROMPT_BUDGET) break
    lines.push(line)
    used += line.length
  }
  return [
    "<memory>",
    "Facts saved from earlier sessions with this user. Use them; update or forget an entry with the memory tool when it is wrong or stale.",
    ...lines,
    "</memory>",
  ].join("\n")
}

export async function MemoryPlugin(input: PluginInput): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": async (_info, output) => {
      const data = await load()
      if (!data.enabled) return
      const block = prompt(await relevant(input.directory))
      if (block) output.system.push(block)
    },
  }
}

export * as ModMemory from "./memory"
