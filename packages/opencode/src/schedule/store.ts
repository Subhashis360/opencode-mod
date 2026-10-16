import { EventEmitter } from "events"
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { Global } from "@opencode-ai/core/global"
import type { Types } from "effect"
import { Schedule, type Run, type Task, type TaskInput, type TaskPatch } from "./schedule"

// Scheduled tasks and their run history live in one small JSON file in the data directory.
// Every change re-reads the file under an in-process lock, so the HTTP routes, the agent tool
// and the runner never overwrite each other's edits.

type Stored = Types.Mutable<Omit<Task, "lastRun">>
type File = { version: 1; tasks: Stored[]; runs: Types.Mutable<Run>[]; requested: string[] }

const RUNS_PER_TASK = 30
const DEFAULTS = { enabled: true, permission: "ask", catchUp: false, notify: true, timeoutMinutes: 60 } as const

export const file = () => path.join(Global.Path.data, "schedules.json")
export const changes = new EventEmitter()

let queue: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn)
  queue = result.catch(() => {})
  return result
}

async function load(): Promise<File> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as Partial<File>
    return { version: 1, tasks: parsed.tasks ?? [], runs: parsed.runs ?? [], requested: parsed.requested ?? [] }
  } catch {
    return { version: 1, tasks: [], runs: [], requested: [] }
  }
}

async function save(data: File) {
  await mkdir(path.dirname(file()), { recursive: true })
  const temp = `${file()}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2))
  await rename(temp, file())
  changes.emit("change")
}

function mutate<T>(fn: (data: File) => T | Promise<T>) {
  return locked(async () => {
    const data = await load()
    const result = await fn(data)
    await save(data)
    return result
  })
}

function withLastRun(data: File, task: Stored): Task {
  const lastRun = data.runs.findLast((run) => run.taskID === task.id)
  return lastRun ? { ...task, lastRun } : task
}

async function checkDirectory(directory: string) {
  const info = await stat(directory).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(`Folder not found: ${directory}`)
}

function clean(input: TaskPatch) {
  const name = input.name?.trim()
  const prompt = input.prompt?.trim()
  if (input.name !== undefined && !name) throw new Error("Give the task a name")
  if (input.prompt !== undefined && !prompt) throw new Error("The task needs a prompt")
  if (input.timeoutMinutes !== undefined && (input.timeoutMinutes < 1 || input.timeoutMinutes > 24 * 60))
    throw new Error("Timeout must be between 1 minute and 24 hours")
  return { ...input, ...(name !== undefined && { name }), ...(prompt !== undefined && { prompt }) }
}

export async function list(): Promise<Task[]> {
  const data = await load()
  return data.tasks.map((task) => withLastRun(data, task))
}

export async function get(id: string): Promise<Task | undefined> {
  const data = await load()
  const task = data.tasks.find((item) => item.id === id)
  return task ? withLastRun(data, task) : undefined
}

export async function create(input: TaskInput): Promise<Task> {
  const values = clean(input)
  Schedule.validate(input.trigger)
  await checkDirectory(input.directory)
  return mutate((data) => {
    const now = Date.now()
    const task: Stored = {
      ...DEFAULTS,
      ...values,
      name: values.name!,
      prompt: values.prompt!,
      directory: path.resolve(input.directory),
      trigger: input.trigger,
      id: randomUUID(),
      created: now,
      updated: now,
      nextRun: Schedule.next(input.trigger, now) ?? null,
    }
    data.tasks.push(task)
    return task
  })
}

export async function update(id: string, patch: TaskPatch): Promise<Task> {
  const values = clean(patch)
  if (patch.trigger) Schedule.validate(patch.trigger)
  if (patch.directory) await checkDirectory(patch.directory)
  return mutate((data) => {
    const index = data.tasks.findIndex((item) => item.id === id)
    if (index < 0) throw new Error("Task not found")
    const current = data.tasks[index]
    const next: Stored = {
      ...current,
      ...values,
      ...(patch.directory && { directory: path.resolve(patch.directory) }),
      updated: Date.now(),
    }
    // Re-plan when the schedule changes or a paused task is switched back on.
    if (patch.trigger || (patch.enabled && !current.enabled) || next.nextRun === null)
      next.nextRun = Schedule.next(next.trigger, Date.now()) ?? null
    data.tasks[index] = next
    return withLastRun(data, next)
  })
}

export async function remove(id: string) {
  return mutate((data) => {
    const before = data.tasks.length
    data.tasks = data.tasks.filter((item) => item.id !== id)
    data.runs = data.runs.filter((run) => run.taskID !== id)
    data.requested = data.requested.filter((item) => item !== id)
    return data.tasks.length < before
  })
}

export async function runs(taskID?: string, limit = 50): Promise<Run[]> {
  const data = await load()
  return data.runs
    .filter((run) => !taskID || run.taskID === taskID)
    .slice(-limit)
    .toReversed()
}

/** Asks the runner to start the task now, without changing its schedule. */
export async function requestRun(id: string) {
  return mutate((data) => {
    if (!data.tasks.some((item) => item.id === id)) throw new Error("Task not found")
    if (!data.requested.includes(id)) data.requested.push(id)
    return true
  })
}

// Runner-only helpers.

export async function takeRequests() {
  return mutate((data) => {
    const requested = data.requested
    data.requested = []
    return requested
  })
}

export async function setNextRun(id: string, nextRun: number | null, disable = false) {
  return mutate((data) => {
    const task = data.tasks.find((item) => item.id === id)
    if (!task) return
    task.nextRun = nextRun
    if (disable) task.enabled = false
  })
}

export async function saveRun(run: Run) {
  return mutate((data) => {
    const index = data.runs.findIndex((item) => item.id === run.id)
    if (index >= 0) data.runs[index] = run
    else data.runs.push(run)
    const mine = data.runs.filter((item) => item.taskID === run.taskID)
    if (mine.length > RUNS_PER_TASK) {
      const drop = new Set(mine.slice(0, mine.length - RUNS_PER_TASK).map((item) => item.id))
      data.runs = data.runs.filter((item) => !drop.has(item.id))
    }
  })
}

/** Runs left "running" by a process that died are closed as cancelled. */
export async function closeOrphans() {
  return mutate((data) => {
    for (const run of data.runs)
      if (run.status === "running")
        Object.assign(run, { status: "cancelled", finished: Date.now(), error: "OpenCode stopped during the run" })
  })
}

export * as ScheduleStore from "./store"
