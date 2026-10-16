import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./schedule.txt"
import { InstanceState } from "@/effect/instance-state"
import { Schedule } from "@/schedule/schedule"
import { ScheduleStore } from "@/schedule/store"

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

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

type Params = Schema.Schema.Type<typeof Parameters>

function trigger(params: Params): Schedule.Trigger | undefined {
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

function line(task: Schedule.Task) {
  const next = task.nextRun ? new Date(task.nextRun).toLocaleString() : "none"
  const last = task.lastRun ? ` | last: ${task.lastRun.status} ${new Date(task.lastRun.started).toLocaleString()}` : ""
  return `${task.id} | ${task.name} | ${Schedule.describe(task.trigger)} | ${task.enabled ? "on" : "paused"} | next: ${next}${last} | ${task.directory}`
}

export const ScheduleTool = Tool.define(
  "schedule",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const confirm = (name: string) =>
            ctx.ask({
              permission: "schedule",
              patterns: [name],
              always: ["*"],
              metadata: { action: params.action, name },
            })
          const fields = {
            ...(params.name !== undefined && { name: params.name }),
            ...(params.prompt !== undefined && { prompt: params.prompt }),
            ...(params.enabled !== undefined && { enabled: params.enabled }),
            ...(params.permission !== undefined && { permission: params.permission }),
            ...(params.catch_up !== undefined && { catchUp: params.catch_up }),
            ...(params.timeout_minutes !== undefined && { timeoutMinutes: params.timeout_minutes }),
          }
          const id = () => {
            if (!params.id) throw new Error(`${params.action} needs the task id (use action "list")`)
            return params.id
          }
          const task = async () => {
            const found = await ScheduleStore.get(id())
            if (!found) throw new Error(`No task with id ${params.id}`)
            return found
          }

          switch (params.action) {
            case "list": {
              const tasks = yield* Effect.promise(ScheduleStore.list)
              return {
                title: `${tasks.length} scheduled tasks`,
                output: tasks.map(line).join("\n") || "No scheduled tasks.",
                metadata: {},
              }
            }
            case "create": {
              const when = trigger(params)
              if (!when || !params.name || !params.prompt) throw new Error("create needs name, prompt and kind")
              yield* confirm(params.name)
              const created = yield* Effect.promise(() =>
                ScheduleStore.create({
                  ...fields,
                  name: params.name!,
                  prompt: params.prompt!,
                  trigger: when,
                  directory: params.directory ?? instance.directory,
                }),
              )
              return { title: `Scheduled ${created.name}`, output: `Created:\n${line(created)}`, metadata: {} }
            }
            case "update": {
              const current = yield* Effect.promise(task)
              yield* confirm(current.name)
              const updated = yield* Effect.promise(() =>
                ScheduleStore.update(current.id, {
                  ...fields,
                  ...(params.directory && { directory: params.directory }),
                  ...(params.kind && { trigger: trigger(params) }),
                }),
              )
              return { title: `Updated ${updated.name}`, output: `Updated:\n${line(updated)}`, metadata: {} }
            }
            case "delete": {
              const current = yield* Effect.promise(task)
              yield* confirm(current.name)
              yield* Effect.promise(() => ScheduleStore.remove(current.id))
              return { title: `Deleted ${current.name}`, output: `Deleted ${current.name}`, metadata: {} }
            }
            case "run": {
              const current = yield* Effect.promise(task)
              yield* confirm(current.name)
              yield* Effect.promise(() => ScheduleStore.requestRun(current.id))
              return {
                title: `Running ${current.name}`,
                output: `Started ${current.name}; it runs in its own session.`,
                metadata: {},
              }
            }
            case "runs": {
              const runs = yield* Effect.promise(() => ScheduleStore.runs(params.id, 10))
              const text = runs
                .map(
                  (run) =>
                    `${new Date(run.started).toLocaleString()} ${run.status}${run.error ? ` (${run.error})` : ""}${run.sessionID ? ` session ${run.sessionID}` : ""}`,
                )
                .join("\n")
              return { title: "Recent runs", output: text || "No runs yet.", metadata: {} }
            }
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
