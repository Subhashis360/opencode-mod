// Built-in system prompts for OpenCode Mod's "System prompt" tab. An agent's `prompt` replaces
// the prompt chosen here (see session/llm/request.ts), which is how the tab applies overrides.
import PROMPT_ANTHROPIC from "../session/prompt/anthropic.txt"
import PROMPT_BEAST from "../session/prompt/beast.txt"
import PROMPT_CODEX from "../session/prompt/codex.txt"
import PROMPT_DEFAULT from "../session/prompt/default.txt"
import PROMPT_GEMINI from "../session/prompt/gemini.txt"
import PROMPT_GPT from "../session/prompt/gpt.txt"
import PROMPT_KIMI from "../session/prompt/kimi.txt"
import PROMPT_META from "../session/prompt/meta.txt"
import PROMPT_TRINITY from "../session/prompt/trinity.txt"

// Mirrors the model matching in session/system.ts.
export const BUILT_IN_PROMPTS = [
  { id: "anthropic", title: "Claude", usedBy: "Claude models", content: PROMPT_ANTHROPIC },
  { id: "gpt", title: "GPT", usedBy: "GPT models other than the ones below", content: PROMPT_GPT },
  { id: "codex", title: "Codex", usedBy: "GPT Codex models", content: PROMPT_CODEX },
  { id: "beast", title: "Beast", usedBy: "GPT-4, o1 and o3 models", content: PROMPT_BEAST },
  { id: "gemini", title: "Gemini", usedBy: "Gemini models", content: PROMPT_GEMINI },
  { id: "kimi", title: "Kimi", usedBy: "Kimi and Moonshot models", content: PROMPT_KIMI },
  { id: "trinity", title: "Trinity", usedBy: "Trinity models", content: PROMPT_TRINITY },
  { id: "meta", title: "Muse", usedBy: "Muse models", content: PROMPT_META },
  { id: "default", title: "Default", usedBy: "Every other model", content: PROMPT_DEFAULT },
] as const

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

// The system prompts as they are now on upstream's default branch, keyed by file name, so users
// can compare with or adopt newer wording without updating the app. Prompts that exist only
// upstream are included; a file that cannot be fetched is left out.
export async function upstreamPrompts(): Promise<Record<string, string>> {
  try {
    const files = paths(await (await fetch(TREE, { signal: AbortSignal.timeout(10_000) })).json())
    const folder = FOLDERS.find((candidate) => files.some((file) => file.startsWith(candidate)))
    if (!folder) return {}
    const names = files
      .filter((file) => file.startsWith(folder) && file.endsWith(".txt") && !file.slice(folder.length).includes("/"))
      .map((file) => file.slice(folder.length, -".txt".length))
      .filter((name) => !NOT_SYSTEM_PROMPTS.test(name))
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          const response = await fetch(`${RAW}${folder}${name}.txt`, { signal: AbortSignal.timeout(10_000) })
          return response.ok ? ([name, await response.text()] as const) : undefined
        } catch {
          return undefined
        }
      }),
    )
    return Object.fromEntries(entries.filter((entry) => entry !== undefined))
  } catch {
    return {}
  }
}
