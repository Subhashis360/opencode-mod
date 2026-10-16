import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { mkdir, readFile, rename, writeFile } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Wildcard } from "@opencode-ai/core/util/wildcard"

// OpenCode Mod: hooks are the user's own shell commands that run on agent events, like Claude
// Code's hooks. They live only in the global config folder (never in a project), so a cloned
// repository cannot plant commands. The command gets the event as JSON on stdin.
//
// Exit codes: 0 = continue (stdout from UserPromptSubmit is added to the prompt as context).
// 2 = PreToolUse blocks the tool call, PostToolUse and UserPromptSubmit pass stderr to the agent.
// Anything else is logged and ignored.

export const EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionIdle",
  "PermissionAsked",
  "SessionError",
] as const
export type HookEvent = (typeof EVENTS)[number]

export type Hook = {
  id: string
  name: string
  event: HookEvent
  matcher?: string
  command: string
  timeout?: number
  enabled: boolean
}

export const file = () => path.join(Global.Path.config, "hooks.json")

export async function list(): Promise<Hook[]> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as { hooks?: Hook[] }
    return (parsed.hooks ?? []).filter((hook) => EVENTS.includes(hook.event) && typeof hook.command === "string")
  } catch {
    return []
  }
}

export async function save(hooks: Omit<Hook, "id">[] | Hook[]) {
  const clean = hooks.map((hook) => {
    if (!EVENTS.includes(hook.event)) throw new Error(`Unknown hook event: ${hook.event}`)
    if (!hook.command.trim()) throw new Error("A hook needs a command")
    return {
      id: "id" in hook && hook.id ? hook.id : randomUUID(),
      name: hook.name.trim() || hook.event,
      event: hook.event,
      ...(hook.matcher?.trim() && { matcher: hook.matcher.trim() }),
      command: hook.command,
      timeout: Math.min(Math.max(Math.round(hook.timeout ?? 30), 1), 600),
      enabled: hook.enabled !== false,
    }
  })
  await mkdir(path.dirname(file()), { recursive: true })
  const temp = `${file()}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify({ hooks: clean }, null, 2))
  await rename(temp, file())
  return clean
}

export type Result = { code: number; stdout: string; stderr: string }

export function run(
  command: string,
  input: unknown,
  options: { cwd: string; timeout: number; env?: Record<string, string> },
) {
  return new Promise<Result>((resolve) => {
    const shell =
      process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]]
        : ["/bin/sh", ["-c", command]]
    const child = spawn(shell[0] as string, shell[1] as string[], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill()
      stderr += `\nHook timed out after ${options.timeout}s`
    }, options.timeout * 1000)
    child.stdout.on("data", (chunk) => (stdout = (stdout + chunk).slice(-20_000)))
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-20_000)))
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: error.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    child.stdin.end(JSON.stringify(input))
  })
}

const matches = (hook: Hook, target?: string) =>
  !hook.matcher ||
  hook.matcher === "*" ||
  (target !== undefined && hook.matcher.split("|").some((part) => Wildcard.match(target, part.trim())))

async function fire(event: HookEvent, target: string | undefined, payload: Record<string, unknown>, cwd: string) {
  const hooks = (await list()).filter((hook) => hook.enabled && hook.event === event && matches(hook, target))
  const results: { hook: Hook; result: Result }[] = []
  for (const hook of hooks) {
    const result = await run(
      hook.command,
      { event, ...payload },
      {
        cwd,
        timeout: hook.timeout ?? 30,
        env: { OPENCODE_HOOK_EVENT: event, ...(target && { OPENCODE_HOOK_TARGET: target }) },
      },
    )
    results.push({ hook, result })
  }
  return results
}

export async function HooksPlugin(input: PluginInput): Promise<Hooks> {
  const cwd = input.directory
  return {
    "tool.execute.before": async (info, output) => {
      for (const { hook, result } of await fire(
        "PreToolUse",
        info.tool,
        { sessionID: info.sessionID, tool: info.tool, input: output?.args, directory: cwd },
        cwd,
      ))
        if (result.code === 2) throw new Error(`Blocked by hook "${hook.name}": ${result.stderr || "no reason given"}`)
    },
    // Subtask runs fire this without an output object.
    "tool.execute.after": async (info, output) => {
      for (const { hook, result } of await fire(
        "PostToolUse",
        info.tool,
        { sessionID: info.sessionID, tool: info.tool, input: info.args, output: output?.output, directory: cwd },
        cwd,
      ))
        if (output && result.code === 2 && result.stderr)
          output.output += `\n\n[hook "${hook.name}"]: ${result.stderr}`
    },
    "chat.message": async (info, output) => {
      if (!output?.parts) return
      const text = output.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
      for (const { hook, result } of await fire(
        "UserPromptSubmit",
        undefined,
        { sessionID: info.sessionID, prompt: text, directory: cwd },
        cwd,
      )) {
        const extra = result.code === 0 ? result.stdout : result.code === 2 ? result.stderr : ""
        if (!extra) continue
        output.parts.push({
          id: `prt_hook${randomUUID().replaceAll("-", "")}`,
          sessionID: info.sessionID,
          messageID: output.message.id,
          type: "text",
          text: `[hook "${hook.name}"]\n${extra}`,
          synthetic: true,
        } as (typeof output.parts)[number])
      }
    },
    event: async ({ event }) => {
      const props = (event as { properties?: Record<string, unknown> }).properties ?? {}
      const type: string = event.type
      if (type === "session.status" && (props.status as { type?: string } | undefined)?.type === "idle")
        await fire("SessionIdle", undefined, { sessionID: props.sessionID, directory: cwd }, cwd)
      else if (type === "permission.asked")
        await fire("PermissionAsked", String(props.permission ?? ""), { ...props, directory: cwd }, cwd)
      else if (type === "session.error") await fire("SessionError", undefined, { ...props, directory: cwd }, cwd)
    },
  }
}

export * as ModHooks from "./hooks"
