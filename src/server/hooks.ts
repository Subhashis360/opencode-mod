export * as ModHooks from "./hooks.js"

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Error as ToolError, type Result as ToolResult } from "@opencode/schema/tool"
import { Effect, Stream } from "effect"
import { Path } from "./paths.js"

// OpenCode Mod: hooks are the user's own shell commands that run on agent events, like Claude Code's hooks. They live
// only in the global config folder (never in a project), so a cloned repository cannot plant commands. The command
// gets the event as JSON on stdin.
//
// Exit codes: 0 = continue (stdout from UserPromptSubmit is added to the prompt as context).
// 2 = PreToolUse blocks the tool call, PostToolUse and UserPromptSubmit pass stderr to the agent.
// Anything else is ignored.

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

export const file = () => path.join(Path.config, "hooks.json")

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

/** `*` and `?` wildcards, case-insensitive, matching the whole name. */
function wildcard(target: string, pattern: string) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${source}$`, "i").test(target)
}

const matches = (hook: Hook, target?: string) =>
  !hook.matcher ||
  hook.matcher === "*" ||
  (target !== undefined && hook.matcher.split("|").some((part) => wildcard(target, part.trim())))

export async function fire(
  event: HookEvent,
  target: string | undefined,
  payload: Record<string, unknown>,
  cwd: string,
) {
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

const appendText = (content: ToolResult["content"], text: string): ToolResult["content"] => {
  if (content === undefined) return text
  if (typeof content === "string") return `${content}\n\n${text}`
  return [...content, { type: "text", text }]
}

export const register = Effect.fn("ModHooks.register")(function* (
  ctx: Pick<Context, "tool" | "session" | "event" | "location">,
) {
  const cwd = ctx.location.directory

  yield* ctx.tool.hook("execute.before", (event) =>
    Effect.promise(() =>
      fire(
        "PreToolUse",
        event.tool,
        { sessionID: event.sessionID, tool: event.tool, input: event.input, directory: cwd },
        cwd,
      ),
    ).pipe(
      Effect.flatMap((results) => {
        const blocked = results.find(({ result }) => result.code === 2)
        if (!blocked) return Effect.void
        return Effect.fail(
          new ToolError({
            message: `Blocked by hook "${blocked.hook.name}": ${blocked.result.stderr || "no reason given"}`,
          }),
        )
      }),
    ),
  )

  yield* ctx.tool.hook("execute.after", (event) =>
    Effect.promise(async () => {
      const output = event.status === "completed" ? event.result.content : event.error.message
      for (const { hook, result } of await fire(
        "PostToolUse",
        event.tool,
        { sessionID: event.sessionID, tool: event.tool, input: event.input, output, directory: cwd },
        cwd,
      ))
        if (event.status === "completed" && result.code === 2 && result.stderr)
          event.result = {
            ...event.result,
            content: appendText(event.result.content, `[hook "${hook.name}"]: ${result.stderr}`),
          }
    }),
  )

  yield* ctx.session.hook("prompt", (event) =>
    Effect.promise(async () => {
      for (const { hook, result } of await fire(
        "UserPromptSubmit",
        undefined,
        { sessionID: event.sessionID, prompt: event.prompt.text, directory: cwd },
        cwd,
      )) {
        const extra = result.code === 0 ? result.stdout : result.code === 2 ? result.stderr : ""
        if (extra) event.prompt.text += `\n\n[hook "${hook.name}"]\n${extra}`
      }
    }),
  )

  yield* ctx.event.subscribe().pipe(
    Stream.runForEach((event) =>
      Effect.promise(async () => {
        const data = (event as { data?: Record<string, unknown> }).data ?? {}
        if (event.type === "session.status" && (data.status as { type?: string } | undefined)?.type === "idle")
          await fire("SessionIdle", undefined, { sessionID: data.sessionID, directory: cwd }, cwd)
        else if (event.type === "permission.asked")
          await fire("PermissionAsked", String(data.action ?? ""), { ...data, directory: cwd }, cwd)
        else if (event.type === "session.execution.failed")
          await fire("SessionError", undefined, { ...data, directory: cwd }, cwd)
      }).pipe(Effect.ignore),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})
