export * as ModPrompts from "./prompts.js"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Path } from "./paths.js"
import ANTHROPIC from "./prompts/anthropic.txt"
import DEFAULT from "./prompts/default.txt"
import GPT_ASTRA from "./prompts/gpt-astra.txt"
import GPT from "./prompts/gpt.txt"
import KIMI from "./prompts/kimi.txt"
import META from "./prompts/meta.txt"
import TRINITY from "./prompts/trinity.txt"

// OpenCode Mod's System prompt tab: OpenCode's current built-in prompts from upstream, to start an agent's prompt
// from, and the user's own library of prompts. The prompt an agent uses is its `system` in the config file.

const TREE = "https://api.github.com/repos/anomalyco/opencode/git/trees/dev?recursive=1"
const RAW = "https://raw.githubusercontent.com/anomalyco/opencode/dev/"
// Upstream has moved these files before (session/prompt in 1.18, plugin/system-prompt later), so the
// folder is looked up instead of assumed. The older folder also holds reminder prompts to skip.
const FOLDERS = ["packages/core/src/plugin/system-prompt/", "packages/opencode/src/session/prompt/"]
const NOT_SYSTEM_PROMPTS = /^(plan|build-switch|copilot)/

const paths = (body: unknown): string[] => {
  if (!body || typeof body !== "object" || !("tree" in body) || !Array.isArray(body.tree)) return []
  return body.tree.flatMap((item: unknown) =>
    item && typeof item === "object" && "path" in item && typeof item.path === "string" ? [item.path] : [],
  )
}

// The prompt every model starts from; the model-specific files above replace it, or for Claude add to it.
const BASE = "packages/core/src/session/runner/prompt/system.txt"
const APPENDED = new Set(["anthropic"])

// OpenCode 2.2.0's prompts, shipped with the plugin for when GitHub cannot be reached.
const BUNDLED: Record<string, string> = {
  default: DEFAULT,
  anthropic: ANTHROPIC,
  gpt: GPT,
  "gpt-astra": GPT_ASTRA,
  kimi: KIMI,
  meta: META,
  trinity: TRINITY,
}

// The tool guidance OpenCode puts in place of ${OPENCODE_TOOL_GUIDANCE} when an agent has the shell, write and edit
// tools, so a prompt copied from here reads as the agent receives it.
const GUIDANCE = [
  "- Prefer dedicated tools over shell commands; fall back to the shell when a tool cannot do what you need.",
  '- Do not chain shell commands with separators like `echo "====";` or `printf \'---\'`; the output becomes noisy in a way that makes the user\'s side of the conversation worse.',
  "- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.",
  "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
].join("\n")

/** A prompt file as an agent gets it: tool guidance filled in, and Claude's addition placed after the base prompt. */
function complete(prompts: Record<string, string>) {
  const render = (text: string) => text.replace("${OPENCODE_TOOL_GUIDANCE}", GUIDANCE).trim()
  const base = render(prompts.default ?? BUNDLED.default!)
  return Object.fromEntries(
    Object.entries(prompts).map(([name, text]) => [
      name,
      name === "default" ? base : APPENDED.has(name) ? `${base}\n\n${render(text)}` : render(text),
    ]),
  )
}

async function raw(file: string) {
  try {
    const response = await fetch(`${RAW}${file}`, { signal: AbortSignal.timeout(10_000) })
    return response.ok ? await response.text() : undefined
  } catch {
    return undefined
  }
}

// The system prompts as they are now on upstream's default branch, keyed by file name ("default" is the one most
// models get), so users can compare with or adopt newer wording without updating the app. Prompts that exist only
// upstream are included; anything that cannot be fetched comes from the copy shipped with the plugin.
export async function upstreamPrompts(): Promise<Record<string, string>> {
  const fetched: Record<string, string> = {}
  try {
    const files = paths(await (await fetch(TREE, { signal: AbortSignal.timeout(10_000) })).json())
    const folder = FOLDERS.find((candidate) => files.some((file) => file.startsWith(candidate)))
    const names = folder
      ? files
          .filter((file) => file.startsWith(folder) && file.endsWith(".txt") && !file.slice(folder.length).includes("/"))
          .map((file) => file.slice(folder.length, -".txt".length))
          .filter((name) => !NOT_SYSTEM_PROMPTS.test(name))
      : []
    const entries = await Promise.all([
      raw(BASE).then((text) => ["default", text] as const),
      ...names.map((name) => raw(`${folder}${name}.txt`).then((text) => [name, text] as const)),
    ])
    for (const [name, text] of entries) if (text) fetched[name] = text
  } catch {
    // Offline or rate limited: the shipped copies below.
  }
  return complete({ ...BUNDLED, ...fetched })
}

export type Saved = { id: string; name: string; content: string; updated: number }

export const file = () => path.join(Path.data, "mod-prompts.json")

export async function library(): Promise<Saved[]> {
  const parsed: unknown = await readFile(file(), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  if (!parsed || typeof parsed !== "object" || !("prompts" in parsed) || !Array.isArray(parsed.prompts)) return []
  return (parsed.prompts as Saved[]).filter((item) => typeof item.name === "string" && typeof item.content === "string")
}

async function write(prompts: Saved[]) {
  await mkdir(path.dirname(file()), { recursive: true })
  const temp = `${file()}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify({ prompts }, null, 2))
  await rename(temp, file())
}

export async function keep(input: { id?: string; name: string; content: string }) {
  const name = input.name.trim()
  if (!name) throw new Error("Give the prompt a name")
  const prompts = await library()
  const entry: Saved = { id: input.id ?? randomUUID().slice(0, 8), name, content: input.content, updated: Date.now() }
  const next = prompts.some((item) => item.id === entry.id)
    ? prompts.map((item) => (item.id === entry.id ? entry : item))
    : [...prompts, entry]
  await write(next)
  return entry
}

export async function drop(id: string) {
  await write((await library()).filter((item) => item.id !== id))
}
