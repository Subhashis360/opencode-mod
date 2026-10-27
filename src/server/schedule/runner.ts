export * as ScheduleRunner from "./runner.js"

import { randomUUID } from "node:crypto"
import { watch, type FSWatcher } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Path } from "../paths.js"
import { METADATA_KEY } from "./metadata.js"
import { Schedule, type Run, type Task } from "./schedule.js"
import { ScheduleStore } from "./store.js"

// Runs scheduled tasks while the OpenCode Mod desktop app is running, in the tray too. It lives in the desktop
// process rather than the server because the server unloads idle projects; each run asks the server for a new
// session in the task's folder, so the server loads that folder itself. Only one process holds the runner lock.

const TICK = 20_000
const LATE = 2 * 60_000
const LOCK_STALE = 90_000

type LiveRun = { -readonly [K in keyof Run]: Run[K] }

export type RunEvent = { task: string; taskID: string; run: Run; kind: "started" | "finished" }

/** The parts of the OpenCode client the runner uses. */
export interface Client {
  readonly session: {
    create(input: {
      title: string
      agent?: string
      model?: { id: string; providerID: string; variant?: string }
      location: { directory: string }
      metadata: { readonly [key: string]: { readonly [field: string]: string } }
    }): Promise<{ id: string }>
    prompt(input: { sessionID: string; text: string }): Promise<unknown>
    wait(input: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<unknown>
    interrupt(input: { sessionID: string }): Promise<unknown>
  }
  readonly message: {
    list(input: {
      sessionID: string
      limit: number
      order: "desc"
      type: "assistant"
    }): Promise<{ data: ReadonlyArray<{ readonly type: string; readonly error?: { message: string } | null }> }>
  }
}

export interface Options {
  /** The server to run tasks on; undefined while it is not up yet. */
  readonly client: () => Client | undefined
  readonly notify?: (event: RunEvent) => void
  readonly log?: (message: string, data?: Record<string, unknown>) => void
}

const lockFile = () => path.join(Path.data, "schedules.lock")

function alive(pid: number) {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

async function holdLock() {
  const current = await readFile(lockFile(), "utf8")
    .then((text) => JSON.parse(text) as { pid: number; at: number })
    .catch(() => undefined)
  const free = !current || current.pid === process.pid || Date.now() - current.at > LOCK_STALE || !alive(current.pid)

  if (!free) return false
  await mkdir(path.dirname(lockFile()), { recursive: true })
  await writeFile(lockFile(), JSON.stringify({ pid: process.pid, at: Date.now() }))

  return true
}

class Timeout extends Error {}

export function start(options: Options) {
  const running = new Map<string, { run: LiveRun; sessionID?: string; stopped?: boolean; abort: AbortController }>()
  let closed = false
  let wake: (() => void) | undefined
  let watcher: FSWatcher | undefined

  const log = (message: string, data?: Record<string, unknown>) => options.log?.(message, data)

  const execute = async (task: Task, run: LiveRun, client: Client, signal: AbortSignal) => {
    const session = await client.session.create({
      title: `Scheduled: ${task.name}`,
      ...(task.agent ? { agent: task.agent } : {}),
      ...(task.model
        ? {
            model: {
              id: task.model.modelID,
              providerID: task.model.providerID,
              ...(task.model.variant ? { variant: task.model.variant } : {}),
            },
          }
        : {}),
      location: { directory: task.directory },
      // The plugin answers this run's approvals by the task's mode (SchedulePlugin's permission hook).
      metadata: { [METADATA_KEY]: { taskID: task.id, runID: run.id, permission: task.permission } },
    })

    run.sessionID = session.id
    const entry = running.get(task.id)

    if (entry) entry.sessionID = session.id
    await ScheduleStore.saveRun(run)
    options.notify?.({ task: task.name, taskID: task.id, run, kind: "started" })

    await client.session.prompt({ sessionID: session.id, text: task.prompt })
    const timer = new Promise<never>((_, reject) => {
      const id = setTimeout(() => reject(new Timeout()), task.timeoutMinutes * 60_000)

      signal.addEventListener("abort", () => clearTimeout(id), { once: true })
    })

    try {
      await Promise.race([client.session.wait({ sessionID: session.id }, { signal }), timer])
    } catch (error) {
      await client.session.interrupt({ sessionID: session.id }).catch(() => undefined)
      throw error
    }

    const [reply] = (await client.message.list({ sessionID: session.id, limit: 1, order: "desc", type: "assistant" }))
      .data

    if (reply?.type === "assistant" && reply.error) throw new Error(reply.error.message)
  }

  const begin = async (task: Task, reason: Run["reason"], client: Client) => {
    const run: LiveRun = {
      id: randomUUID(),
      taskID: task.id,
      reason,
      started: Date.now(),
      status: "running",
      directory: task.directory,
    }
    const abort = new AbortController()

    running.set(task.id, { run, abort })
    await ScheduleStore.saveRun(run)
    void execute(task, run, client, abort.signal)
      .then(
        () => ({ status: "success" as const }),
        (error: unknown) => {
          if (running.get(task.id)?.stopped) return { status: "cancelled" as const }

          if (error instanceof Timeout)
            return { status: "timeout" as const, error: `Stopped after ${task.timeoutMinutes} minutes` }

          return { status: "failed" as const, error: error instanceof Error ? error.message : String(error) }
        },
      )
      .then(async (outcome) => {
        abort.abort()
        running.delete(task.id)
        const finished: Run = { ...run, finished: Date.now(), ...outcome }

        await ScheduleStore.saveRun(finished)

        if (task.notify) options.notify?.({ task: task.name, taskID: task.id, run: finished, kind: "finished" })
      })
      .catch((error: unknown) => log("scheduled run bookkeeping failed", { error: String(error) }))
  }

  const record = (task: Task, status: "missed" | "skipped", error: string) =>
    ScheduleStore.saveRun({
      id: randomUUID(),
      taskID: task.id,
      reason: "schedule",
      started: task.nextRun ?? Date.now(),
      finished: Date.now(),
      status,
      directory: task.directory,
      error,
    })

  const stop = async (taskID: string, client: Client | undefined) => {
    const entry = running.get(taskID)

    if (!entry) return
    entry.stopped = true

    if (entry.sessionID && client) await client.session.interrupt({ sessionID: entry.sessionID }).catch(() => undefined)
    entry.abort.abort()
  }

  const tick = async () => {
    const client = options.client()

    for (const id of await ScheduleStore.takeStops()) await stop(id, client)

    const now = Date.now()

    // Without a server, nothing can run: leave requests and due tasks for the next tick.
    if (!client) return now + TICK

    for (const id of await ScheduleStore.takeRequests()) {
      const task = await ScheduleStore.get(id)

      if (task && !running.has(id)) await begin(task, "manual", client)
    }

    let soonest = now + TICK

    for (const task of await ScheduleStore.list()) {
      if (!task.enabled || task.nextRun === null) continue

      if (task.nextRun > now) {
        soonest = Math.min(soonest, task.nextRun)
        continue
      }

      const following = Schedule.next(task.trigger, now) ?? null

      await ScheduleStore.setNextRun(task.id, following, following === null)

      if (following !== null) soonest = Math.min(soonest, following)
      const late = now - task.nextRun > LATE

      if (running.has(task.id)) await record(task, "skipped", "The previous run was still going")
      else if (late && !task.catchUp) await record(task, "missed", "OpenCode Mod was not running at the scheduled time")
      else await begin(task, late ? "catchup" : "schedule", client)
    }

    return soonest
  }

  // Edits from the server (the agent tool, the Mod settings) land in the file, so a change wakes the loop early.
  const listen = () => {
    try {
      watcher = watch(path.dirname(ScheduleStore.file()), (_, name) => {
        if (name === path.basename(ScheduleStore.file())) wake?.()
      })
      watcher.on("error", () => undefined)
    } catch {
      // The folder may not exist yet; the timer still ticks.
    }
  }

  const loop = async () => {
    let owner = false

    await mkdir(path.dirname(ScheduleStore.file()), { recursive: true }).catch(() => undefined)
    listen()

    while (!closed) {
      const held = await holdLock().catch(() => false)

      if (closed) break

      if (held && !owner) await ScheduleStore.closeOrphans().catch(() => undefined)
      owner = held
      const soonest = held
        ? await tick().catch((error: unknown) => {
            log("scheduled task tick failed", { error: String(error) })

            return Date.now() + TICK
          })
        : Date.now() + TICK

      await new Promise<void>((resolve) => {
        if (closed) return resolve()

        const timer = setTimeout(resolve, Math.max(1_000, Math.min(soonest - Date.now(), TICK)))

        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      wake = undefined
    }
  }

  const looping = loop().catch((error: unknown) => log("scheduled task runner stopped", { error: String(error) }))

  return {
    active: () => [...running.keys()],
    /** Stops the loop and any running tasks, and gives the lock back. */
    close: async () => {
      closed = true
      wake?.()
      watcher?.close()
      // A tick in progress finishes first, so nothing starts after close returns.
      await looping
      const client = options.client()

      await Promise.all([...running.keys()].map((id) => stop(id, client)))
      const current = await readFile(lockFile(), "utf8").catch(() => "")

      if (current.includes(`"pid":${process.pid},`)) await rm(lockFile(), { force: true })
    },
  }
}
