export * as ComputerPlugin from "./plugin.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Error as ToolError, type Tool } from "@opencode/schema/tool"
import { Cause, Effect, Exit, Stream } from "effect"
import DESCRIPTION from "./description.txt"
import { ComputerAurora } from "./aurora.js"
import { ComputerDriver } from "./driver.js"
import { ComputerTool } from "./tool.js"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Events that mean a session stopped working. */
const STOPPED = new Set<string>([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.error",
])

const READ = "[screenshot removed after the model read it]"

type Part = { readonly type: string; readonly name?: string; readonly mime?: string; readonly result?: unknown }
type Message = { readonly role?: string; readonly content: readonly Part[] }

const image = (part: { readonly type: string; readonly mime?: string }) =>
  part.type === "file" && typeof part.mime === "string" && part.mime.startsWith("image/")

const computerResult = (part: Part) =>
  part.type === "tool-result" && (part.name === "computer" || part.name?.endsWith(".computer") === true)

/** The computer tool's result with its screenshots replaced by a note, or undefined when it had none. */
function stripResult(part: Part): Part | undefined {
  const result = part.result as { type?: string; value?: unknown } | undefined
  if (result?.type !== "content" || !Array.isArray(result.value)) return undefined
  const value = result.value as { type: string; mime?: string }[]
  if (!value.some(image)) return undefined
  return { ...part, result: { ...result, value: value.map((item) => (image(item) ? { type: "text", text: READ } : item)) } }
}

/**
 * Drops every computer screenshot the model has already seen from the request: only the newest one stays. Old
 * screenshots are re-sent on every step otherwise, which makes each step slower and costlier. The files themselves
 * are deleted as soon as they are encoded.
 */
export function forgetSeenScreenshots(messages: Message[]) {
  let newest = -1
  messages.forEach((message, index) => {
    if (message.content.some((part) => computerResult(part) && stripResult(part))) newest = index
  })
  for (let index = 0; index < newest; index++) {
    const message = messages[index]!
    let changed = false
    const content = message.content.map((part) => {
      if (!computerResult(part)) return part
      const stripped = stripResult(part)
      if (stripped) changed = true
      return stripped ?? part
    })
    if (!changed) continue
    // Rebuilt with the message's own class, so the host still gets the type it made.
    const Make: unknown = message.constructor
    messages[index] =
      typeof Make === "function" && Make !== Object
        ? new (Make as new (input: unknown) => Message)({ ...message, content })
        : { ...message, content }
  }
}

/**
 * Adds the computer tool while `enabled()` says so. Call `ctx.tool.reload()` after the setting changes and the tool
 * appears or goes without a restart.
 */
export const register = Effect.fn("ComputerPlugin.register")(function* (
  ctx: Pick<Context, "tool" | "permission" | "session"> & Partial<Pick<Context, "event">>,
  enabled: () => boolean,
) {
  yield* ctx.session.hook("context", (event) =>
    Effect.sync(() => forgetSeenScreenshots(event.messages as unknown as Message[])).pipe(Effect.ignore),
  )

  const execute = (input: ComputerTool.Params, tool: Tool.Context) =>
    Effect.gen(function* () {
      // The prompt's own failure (a deny rule, or the user's refusal) is kept and re-raised unchanged, so a refused
      // app stops the run exactly as a refused edit or shell command does.
      let refused: Cause.Cause<Tool.Error> | undefined
      const ask = (resources: string[], metadata: Record<string, unknown>) =>
        Effect.runPromiseExit(
          ctx.permission.assert({
            sessionID: tool.sessionID,
            agent: tool.agent,
            action: "computer",
            resources,
            save: resources,
            metadata,
          }),
        ).then((exit) => {
          if (Exit.isSuccess(exit)) return
          refused = exit.cause
          throw new Error("Permission refused")
        })

      const result = yield* Effect.tryPromise({
        try: (signal) => ComputerTool.execute(input, { sessionID: tool.sessionID, ask, aborted: () => signal.aborted }),
        catch: (error) => new ToolError({ message: message(error), error }),
      })
      if ("rejected" in result)
        return yield* Effect.failCause(refused ?? Cause.fail(new ToolError({ message: "Permission refused" })))

      return {
        content: [{ type: "text" as const, text: result.output }, ...result.attachments],
        metadata: { title: result.title },
      }
    })

  // The glow around the screen goes as soon as the session stops working, not only after its quiet minute. The
  // status event is ephemeral and may not reach plugins, so the durable end-of-run events count too.
  if (ctx.event)
    yield* ctx.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          const data = (event as { data?: { sessionID?: unknown; status?: { type?: unknown } } }).data
          const done =
            STOPPED.has(event.type) || (event.type === "session.status" && data?.status?.type === "idle")
          if (done && typeof data?.sessionID === "string") ComputerAurora.release(data.sessionID)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

  yield* ctx.tool
    .transform((editor) => {
      if (!enabled() || !ComputerDriver.supported()) return
      editor.add({
        name: "computer",
        description: DESCRIPTION,
        input: ComputerTool.Parameters,
        // Screenshots must reach the model as images, which code mode would turn into text.
        options: { permission: "computer", codemode: false },
        execute,
      })
    })
    .pipe(Effect.orDie)
})
