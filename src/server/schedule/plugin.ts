export * as SchedulePlugin from "./plugin.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionID } from "@opencode/schema/session-id"
import { Error as ToolError } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./description.txt"
import { Schedule } from "./schedule.js"
import { ScheduleStore } from "./store.js"

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

export { METADATA_KEY } from "./metadata.js"
import { METADATA_KEY } from "./metadata.js"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "create", "update", "delete", "run", "runs"]),
  id: Schema.optional(Schema.String).annotate({ description: "Task id, for update, delete, run and runs" }),
  name: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String).annotate({ description: "What the agent should do on each run" }),
  directory: Schema.optional(Schema.String).annotate({ description: "Project folder; defaults to the current one" }),
  kind: Schema.optional(Schema.Literals(["once", "interval", "daily", "weekly", "monthly", "cron"])),
  at: Schema.optional(Schema.String).annotate({ description: "once: local date and time, e.g. 2026-10-17T09:00" }),
  time: Schema.optional(Schema.String).annotate({ description: "daily/weekly/monthly: 24-hour HH:MM" }),
  days: Schema.optional(Schema.Array(Schema.String)).annotate({ description: 'weekly: e.g. ["mon", "thu"]' }),
  day: Schema.optional(Schema.Number).annotate({ description: "monthly: day of month 1-31 (clamped to month end)" }),
  minutes: Schema.optional(Schema.Number).annotate({ description: "interval: run every N minutes" }),
  cron: Schema.optional(Schema.String).annotate({ description: "cron: 5-field expression in local time" }),
  enabled: Schema.optional(Schema.Boolean),
  permission: Schema.optional(Schema.Literals(["ask", "deny", "allow"])).annotate({
    description: "Unattended approvals: ask waits for the user (default), deny skips them, allow approves them",
  }),
  catch_up: Schema.optional(Schema.Boolean).annotate({ description: "Run once at startup after a missed run" }),
  timeout_minutes: Schema.optional(Schema.Number),
})

export type Params = Schema.Schema.Type<typeof Parameters>

export function trigger(params: Params): Schedule.Trigger | undefined {
  if (!params.kind) return undefined

  const need = <T>(value: T | undefined, field: string) => {
    if (value === undefined) throw new Error(`kind "${params.kind}" needs ${field}`)

    return value
  }

  switch (params.kind) {
    case "once": {
      const at = new Date(need(params.at, "at")).getTime()

      if (Number.isNaN(at)) throw new Error(`Cannot read the date "${params.at}"`)

      return { kind: "once", at }
    }
    case "interval":
      return { kind: "interval", minutes: need(params.minutes, "minutes") }
    case "daily":
      return { kind: "daily", time: need(params.time, "time") }
    case "weekly": {
      const days = need(params.days, "days").map((day) => {
        const index = DAYS.indexOf(day.slice(0, 3).toLowerCase())

        if (index < 0) throw new Error(`Unknown weekday "${day}"`)

        return index
      })

      return { kind: "weekly", time: need(params.time, "time"), days }
    }
    case "monthly":
      return { kind: "monthly", time: need(params.time, "time"), day: need(params.day, "day") }
    case "cron":
      return { kind: "cron", expression: need(params.cron, "cron") }
  }
}

export function line(task: Schedule.Task) {
  const next = task.nextRun ? new Date(task.nextRun).toLocaleString() : "none"
  const last = task.lastRun ? ` | last: ${task.lastRun.status} ${new Date(task.lastRun.started).toLocaleString()}` : ""

  return `${task.id} | ${task.name} | ${Schedule.describe(task.trigger)} | ${task.enabled ? "on" : "paused"} | next: ${next}${last} | ${task.directory}`
}

/** What the tool does, apart from asking: kept separate so it can be tested without a host. */
export async function run(params: Params, directory: string, confirm: (name: string) => Promise<void>) {
  const fields = {
    ...(params.name !== undefined && { name: params.name }),
    ...(params.prompt !== undefined && { prompt: params.prompt }),
    ...(params.enabled !== undefined && { enabled: params.enabled }),
    ...(params.permission !== undefined && { permission: params.permission }),
    ...(params.catch_up !== undefined && { catchUp: params.catch_up }),
    ...(params.timeout_minutes !== undefined && { timeoutMinutes: params.timeout_minutes }),
  }

  const task = async () => {
    if (!params.id) throw new Error(`${params.action} needs the task id (use action "list")`)
    const found = await ScheduleStore.get(params.id)

    if (!found) throw new Error(`No task with id ${params.id}`)

    return found
  }

  switch (params.action) {
    case "list": {
      const tasks = await ScheduleStore.list()

      return tasks.map(line).join("\n") || "No scheduled tasks."
    }
    case "create": {
      const when = trigger(params)

      if (!when || !params.name || !params.prompt) throw new Error("create needs name, prompt and kind")
      await confirm(params.name)
      const created = await ScheduleStore.create({
        ...fields,
        name: params.name,
        prompt: params.prompt,
        trigger: when,
        directory: params.directory ?? directory,
      })

      return `Created:\n${line(created)}`
    }
    case "update": {
      const current = await task()

      await confirm(current.name)
      const when = params.kind ? trigger(params) : undefined
      const updated = await ScheduleStore.update(current.id, {
        ...fields,
        ...(params.directory && { directory: params.directory }),
        ...(when && { trigger: when }),
      })

      return `Updated:\n${line(updated)}`
    }
    case "delete": {
      const current = await task()

      await confirm(current.name)
      await ScheduleStore.remove(current.id)

      return `Deleted ${current.name}`
    }
    case "run": {
      const current = await task()

      await confirm(current.name)
      await ScheduleStore.requestRun(current.id)

      return `Started ${current.name}; it runs in its own session while the OpenCode Mod app is running.`
    }
    case "runs": {
      const runs = await ScheduleStore.runs(params.id, 10)

      return (
        runs
          .map(
            (item) =>
              `${new Date(item.started).toLocaleString()} ${item.status}${item.error ? ` (${item.error})` : ""}${item.sessionID ? ` session ${item.sessionID}` : ""}`,
          )
          .join("\n") || "No runs yet."
      )
    }
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

type Mode = Schedule.PermissionMode

/** The permission mode of the scheduled run a session belongs to, looking through subagent parents. */
const modeOf = (ctx: Pick<Context, "session">, cache: Map<string, Mode | null>) =>
  Effect.fnUntraced(function* (sessionID: SessionID) {
    const seen: string[] = []
    let current: SessionID | undefined = sessionID
    let found: Mode | null = null

    for (let depth = 0; current && depth < 8; depth++) {
      const cached = cache.get(current)

      if (cached !== undefined) {
        found = cached
        break
      }

      seen.push(current)
      const session: Session.Info | undefined = yield* ctx.session
        .get({ sessionID: current })
        .pipe(Effect.orElseSucceed(() => undefined))

      if (!session) break
      const tag = session.metadata?.[METADATA_KEY]
      const mode = typeof tag === "object" && tag !== null && "permission" in tag ? tag.permission : undefined

      if (mode === "ask" || mode === "allow" || mode === "deny") {
        found = mode
        break
      }

      current = session.parentID ?? undefined
    }

    for (const id of seen) cache.set(id, found)

    return found
  })

export const register = Effect.fn("SchedulePlugin.register")(function* (
  ctx: Pick<Context, "tool" | "permission" | "session" | "location">,
) {
  yield* ctx.tool
    .transform((editor) => {
      editor.add({
        name: "schedule",
        description: DESCRIPTION,
        input: Parameters,
        options: { permission: "schedule", codemode: false },
        execute: (input, tool) =>
          Effect.gen(function* () {
            const confirm = (name: string) =>
              Effect.runPromise(
                ctx.permission.assert({
                  sessionID: tool.sessionID,
                  agent: tool.agent,
                  action: "schedule",
                  resources: [name],
                  save: ["*"],
                  metadata: { action: input.action, name },
                }),
              )

            const text = yield* Effect.tryPromise({
              try: () => run(input, ctx.location.directory, confirm),
              catch: (error) => new ToolError({ message: message(error), error }),
            })

            return { content: text, metadata: { title: `schedule ${input.action}` } }
          }),
      })
    })
    .pipe(Effect.orDie)

  // Unattended runs: a step that would wait for approval is answered by the task's mode instead. "ask" leaves the
  // prompt for the user; explicit deny rules always stay denied.
  const cache = new Map<string, Mode | null>()
  const lookup = modeOf(ctx, cache)

  yield* ctx.permission.hook("evaluate", (event) =>
    Effect.gen(function* () {
      if (event.effect !== "ask") return
      const mode = yield* lookup(event.sessionID)

      if (!mode || mode === "ask") return

      if (mode === "allow") {
        event.effect = "allow"

        return
      }

      event.effect = "deny"
      event.message =
        event.action === "question"
          ? "This is an unattended scheduled run, so nobody can answer questions. Decide yourself and continue."
          : "This is an unattended scheduled run and approvals are turned off. Continue without this step."
    }),
  )
})
