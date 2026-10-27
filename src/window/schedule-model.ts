// The Scheduled tab's editor state and how it maps to a task, kept free of Solid so it can be unit tested.
import type { Schedule } from "../server/schedule/schedule"

export type Kind = Schedule.Trigger["kind"]

export const KINDS: readonly Kind[] = ["daily", "weekly", "monthly", "interval", "once", "cron"]

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

export const MODES = ["ask", "deny", "allow"] as const

export type Mode = (typeof MODES)[number]

export type Draft = {
  id?: string
  name: string
  prompt: string
  directory: string
  kind: Kind
  at: string
  minutes: string
  time: string
  days: number[]
  day: string
  cron: string
  agent: string
  model: string
  permission: Mode
  catchUp: boolean
  notify: boolean
  timeout: string
}

const pad = (value: number) => String(value).padStart(2, "0")

/** A time as a `datetime-local` input value. */
export function localInput(time: number) {
  const date = new Date(time)

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function draftFrom(task?: Schedule.Task, directory = "", now = Date.now()): Draft {
  const trigger = task?.trigger

  return {
    ...(task ? { id: task.id } : {}),
    name: task?.name ?? "",
    prompt: task?.prompt ?? "",
    directory: task?.directory ?? directory,
    kind: trigger?.kind ?? "daily",
    at: localInput(trigger?.kind === "once" ? trigger.at : now + 60 * 60_000),
    minutes: String(trigger?.kind === "interval" ? trigger.minutes : 60),
    time: trigger && "time" in trigger ? trigger.time : "09:00",
    days: trigger?.kind === "weekly" ? [...trigger.days] : [1, 2, 3, 4, 5],
    day: String(trigger?.kind === "monthly" ? trigger.day : 1),
    cron: trigger?.kind === "cron" ? trigger.expression : "0 9 * * 1-5",
    agent: task?.agent ?? "",
    model: task?.model ? `${task.model.providerID}/${task.model.modelID}` : "",
    permission: task?.permission ?? "ask",
    catchUp: task?.catchUp ?? false,
    notify: task?.notify ?? true,
    timeout: String(task?.timeoutMinutes ?? 60),
  }
}

export function trigger(draft: Draft): Schedule.Trigger {
  switch (draft.kind) {
    case "once":
      return { kind: "once", at: new Date(draft.at).getTime() }
    case "interval":
      return { kind: "interval", minutes: Number(draft.minutes) }
    case "daily":
      return { kind: "daily", time: draft.time }
    case "weekly":
      return { kind: "weekly", time: draft.time, days: [...draft.days].sort() }
    case "monthly":
      return { kind: "monthly", time: draft.time, day: Number(draft.day) }
    case "cron":
      return { kind: "cron", expression: draft.cron.trim() }
  }
}

/** The task to save. The server checks the schedule and the folder and explains what is wrong. */
export function toInput(draft: Draft): Schedule.TaskInput {
  const slash = draft.model.indexOf("/")

  return {
    name: draft.name.trim(),
    prompt: draft.prompt,
    directory: draft.directory.trim(),
    trigger: trigger(draft),
    ...(draft.agent.trim() ? { agent: draft.agent.trim() } : {}),
    ...(slash > 0
      ? { model: { providerID: draft.model.slice(0, slash), modelID: draft.model.slice(slash + 1).trim() } }
      : {}),
    permission: draft.permission,
    catchUp: draft.catchUp,
    notify: draft.notify,
    timeoutMinutes: Number(draft.timeout) || 60,
  }
}

export function toggleDay(days: readonly number[], day: number) {
  return days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort()
}
