import { Schema } from "effect"

// Scheduled tasks: what runs, when, and how unattended permission prompts are handled.
// All wall-clock schedules use the machine's local time zone.

const Time = Schema.String.check(
  Schema.makeFilter((value) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? undefined : "Expected HH:MM (24-hour)")),
)

export const Trigger = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("once"), at: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("interval"), minutes: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("daily"), time: Time }),
  Schema.Struct({ kind: Schema.Literal("weekly"), time: Time, days: Schema.Array(Schema.Finite) }),
  Schema.Struct({ kind: Schema.Literal("monthly"), time: Time, day: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("cron"), expression: Schema.String }),
]).annotate({ identifier: "ScheduleTrigger" })
export type Trigger = typeof Trigger.Type

// ask: prompts wait for the user. deny: anything needing approval is rejected so the run never
// stalls. allow: prompts are approved once each; explicit deny rules still apply.
export const PermissionMode = Schema.Literals(["ask", "deny", "allow"])
export type PermissionMode = typeof PermissionMode.Type

const ModelChoice = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
})

export const TaskInput = Schema.Struct({
  name: Schema.String,
  prompt: Schema.String,
  directory: Schema.String,
  trigger: Trigger,
  enabled: Schema.optional(Schema.Boolean),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ModelChoice),
  permission: Schema.optional(PermissionMode),
  catchUp: Schema.optional(Schema.Boolean).annotate({
    description: "Run once at startup if a run was missed while the computer was off or asleep",
  }),
  notify: Schema.optional(Schema.Boolean),
  timeoutMinutes: Schema.optional(Schema.Finite),
}).annotate({ identifier: "ScheduleTaskInput" })
export type TaskInput = typeof TaskInput.Type

export const TaskPatch = Schema.Struct({
  name: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  trigger: Schema.optional(Trigger),
  enabled: Schema.optional(Schema.Boolean),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ModelChoice),
  permission: Schema.optional(PermissionMode),
  catchUp: Schema.optional(Schema.Boolean),
  notify: Schema.optional(Schema.Boolean),
  timeoutMinutes: Schema.optional(Schema.Finite),
}).annotate({ identifier: "ScheduleTaskPatch" })
export type TaskPatch = typeof TaskPatch.Type

export const RunStatus = Schema.Literals(["running", "success", "failed", "timeout", "cancelled", "skipped", "missed"])
export type RunStatus = typeof RunStatus.Type

export const Run = Schema.Struct({
  id: Schema.String,
  taskID: Schema.String,
  reason: Schema.Literals(["schedule", "manual", "catchup"]),
  started: Schema.Finite,
  finished: Schema.optional(Schema.Finite),
  status: RunStatus,
  sessionID: Schema.optional(Schema.String),
  directory: Schema.String,
  error: Schema.optional(Schema.String),
  handled: Schema.optional(Schema.Finite).annotate({ description: "Prompts answered automatically" }),
}).annotate({ identifier: "ScheduleRun" })
export type Run = typeof Run.Type

export const Task = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  directory: Schema.String,
  trigger: Trigger,
  enabled: Schema.Boolean,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ModelChoice),
  permission: PermissionMode,
  catchUp: Schema.Boolean,
  notify: Schema.Boolean,
  timeoutMinutes: Schema.Finite,
  created: Schema.Finite,
  updated: Schema.Finite,
  nextRun: Schema.NullOr(Schema.Finite),
  lastRun: Schema.optional(Run),
}).annotate({ identifier: "ScheduleTask" })
export type Task = typeof Task.Type

const MINUTE = 60_000
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

function at(base: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number)
  const result = new Date(base)
  result.setHours(hours, minutes, 0, 0)
  return result
}

function lastDay(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

/** Throws with a readable message when a trigger can never fire or is malformed. */
export function validate(trigger: Trigger, now = Date.now()) {
  if (trigger.kind === "once" && trigger.at <= now) throw new Error("That time is already in the past")
  if (trigger.kind === "interval" && (!Number.isInteger(trigger.minutes) || trigger.minutes < 1))
    throw new Error("Interval must be a whole number of minutes, at least 1")
  if (trigger.kind === "weekly" && (trigger.days.length === 0 || trigger.days.some((day) => day < 0 || day > 6)))
    throw new Error("Pick at least one weekday (0 = Sunday ... 6 = Saturday)")
  if (trigger.kind === "monthly" && (!Number.isInteger(trigger.day) || trigger.day < 1 || trigger.day > 31))
    throw new Error("Day of month must be 1-31")
  if (trigger.kind === "cron") parseCron(trigger.expression)
  if (next(trigger, now) === undefined) throw new Error("This schedule never runs")
}

/** The first run strictly after `after`, or undefined when the trigger is spent. */
export function next(trigger: Trigger, after: number): number | undefined {
  const base = new Date(after)
  switch (trigger.kind) {
    case "once":
      return trigger.at > after ? trigger.at : undefined
    case "interval":
      return after + Math.max(1, trigger.minutes) * MINUTE
    case "daily": {
      const today = at(base, trigger.time)
      if (today.getTime() > after) return today.getTime()
      today.setDate(today.getDate() + 1)
      return at(today, trigger.time).getTime()
    }
    case "weekly": {
      for (let offset = 0; offset < 8; offset++) {
        const day = new Date(base)
        day.setDate(base.getDate() + offset)
        const candidate = at(day, trigger.time)
        if (trigger.days.includes(candidate.getDay()) && candidate.getTime() > after) return candidate.getTime()
      }
      return undefined
    }
    case "monthly": {
      for (let offset = 0; offset < 14; offset++) {
        const month = new Date(base.getFullYear(), base.getMonth() + offset, 1)
        month.setDate(Math.min(trigger.day, lastDay(month.getFullYear(), month.getMonth())))
        const candidate = at(month, trigger.time)
        if (candidate.getTime() > after) return candidate.getTime()
      }
      return undefined
    }
    case "cron":
      return nextCron(parseCron(trigger.expression), after)
  }
}

type Cron = {
  minute: number[]
  hour: number[]
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  anyDom: boolean
  anyDow: boolean
}

function field(text: string, min: number, max: number, names?: string[]) {
  const values = new Set<number>()
  const value = (raw: string) => {
    const lower = raw.toLowerCase()
    const named = names?.indexOf(lower) ?? -1
    const number = named >= 0 ? named + min : Number(lower)
    if (!Number.isInteger(number) || number < min || number > max + (names === DAY_NAMES ? 1 : 0))
      throw new Error(`Invalid cron value "${raw}"`)
    return number
  }
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/")
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step "${part}"`)
    const [start, end] =
      range === "*"
        ? [min, max]
        : range.includes("-")
          ? range.split("-").map(value)
          : [value(range), stepText ? max : value(range)]
    if (start > end) throw new Error(`Invalid cron range "${part}"`)
    for (let item = start; item <= end; item += step) values.add(names === DAY_NAMES && item === 7 ? 0 : item)
  }
  return values
}

export function parseCron(expression: string): Cron {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error("Cron needs 5 fields: minute hour day-of-month month day-of-week")
  const sorted = (set: Set<number>) => [...set].toSorted((a, b) => a - b)
  return {
    minute: sorted(field(parts[0], 0, 59)),
    hour: sorted(field(parts[1], 0, 23)),
    dom: field(parts[2], 1, 31),
    month: field(parts[3], 1, 12, MONTH_NAMES),
    dow: field(parts[4], 0, 6, DAY_NAMES),
    anyDom: parts[2] === "*",
    anyDow: parts[4] === "*",
  }
}

function nextCron(cron: Cron, after: number) {
  const start = new Date(after)
  for (let offset = 0; offset < 366 * 5; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
    if (!cron.month.has(day.getMonth() + 1)) continue
    const domMatch = cron.dom.has(day.getDate())
    const dowMatch = cron.dow.has(day.getDay())
    // Standard cron: when both day fields are restricted, either one matching is enough.
    const dayMatch = cron.anyDom ? cron.anyDow || dowMatch : cron.anyDow ? domMatch : domMatch || dowMatch
    if (!dayMatch) continue
    for (const hour of cron.hour)
      for (const minute of cron.minute) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime()
        if (candidate > after) return candidate
      }
  }
  return undefined
}

const pad = (value: number) => String(value).padStart(2, "0")

export function describe(trigger: Trigger) {
  switch (trigger.kind) {
    case "once": {
      const date = new Date(trigger.at)
      return `Once on ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    case "interval":
      return trigger.minutes % 60 === 0 ? `Every ${trigger.minutes / 60} hour(s)` : `Every ${trigger.minutes} minute(s)`
    case "daily":
      return `Every day at ${trigger.time}`
    case "weekly":
      return `Every ${trigger.days
        .toSorted()
        .map((day) => DAY_NAMES[day])
        .join(", ")} at ${trigger.time}`
    case "monthly":
      return `Monthly on day ${trigger.day} at ${trigger.time}`
    case "cron":
      return `Cron "${trigger.expression}"`
  }
}

export * as Schedule from "./schedule.js"
