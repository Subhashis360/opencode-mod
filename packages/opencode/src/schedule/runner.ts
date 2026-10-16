import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Global } from "@opencode-ai/core/global"
import { Cause, Context, Duration, Effect, Exit, Fiber, Layer, Scope, type Types } from "effect"
import { randomUUID } from "crypto"
import { readFile, rm, writeFile } from "fs/promises"
import path from "path"
import { GlobalBus } from "@/bus/global"
import { Permission } from "@/permission"
import { InstanceStore } from "@/project/instance-store"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { Schedule, type Run, type Task } from "./schedule"
import { ScheduleStore } from "./store"

// Runs scheduled tasks while this OpenCode process is alive. Only one process at a time holds
// the runner lock, so the desktop app and a terminal server never run the same task twice.

const TICK = 20_000
type LiveRun = Types.Mutable<Run>

const LATE = 2 * 60_000
const LOCK_STALE = 90_000
const POLL = 1_000

export type RunEvent = { task: string; taskID: string; run: Run; kind: "started" | "finished" | "approval" }

export interface Interface {
  readonly active: () => Effect.Effect<string[]>
  readonly cancel: (taskID: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ScheduleRunner") {}

const lockFile = () => path.join(Global.Path.data, "schedules.lock")

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
  await writeFile(lockFile(), JSON.stringify({ pid: process.pid, at: Date.now() }))
  return true
}

function emit(directory: string, event: RunEvent) {
  GlobalBus.emit("event", { directory, payload: { type: "mod.schedule.run", properties: event } })
}

function waitForChange(ms: number) {
  return Effect.callback<void>((resume) => {
    const done = () => resume(Effect.void)
    const timer = setTimeout(done, Math.max(1_000, ms))
    ScheduleStore.changes.once("change", done)
    return Effect.sync(() => {
      clearTimeout(timer)
      ScheduleStore.changes.off("change", done)
    })
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const instances = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const prompts = yield* SessionPrompt.Service
    const permissions = yield* Permission.Service
    const questions = yield* Question.Service
    const scope = yield* Scope.Scope
    const running = new Map<string, { fiber: Fiber.Fiber<void>; run: LiveRun; sessionID?: string; stopped?: boolean }>()

    // Answers prompts from the run's session and its subagents according to the task's mode.
    const respond = (task: Task, root: string, run: LiveRun) =>
      Effect.gen(function* () {
        const seen = new Set<string>()
        const family = new Set([root])
        for (let i = 0; ; i++) {
          yield* Effect.sleep(Duration.millis(POLL))
          if (i % 5 === 0)
            for (const id of [...family])
              for (const child of yield* sessions.children(SessionID.make(id)).pipe(Effect.orElseSucceed(() => [])))
                family.add(child.id)
          const asks = (yield* permissions.list()).filter((item) => family.has(item.sessionID) && !seen.has(item.id))
          const pendingQuestions = (yield* questions.list()).filter(
            (item) => family.has(item.sessionID) && !seen.has(item.id),
          )
          for (const ask of asks) {
            seen.add(ask.id)
            if (task.permission === "ask") {
              emit(task.directory, { task: task.name, taskID: task.id, run, kind: "approval" })
              continue
            }
            yield* permissions
              .reply({
                requestID: ask.id,
                reply: task.permission === "allow" ? "once" : "reject",
                ...(task.permission === "deny" && {
                  message:
                    "This is an unattended scheduled run and approvals are turned off. Continue without this step.",
                }),
              })
              .pipe(Effect.ignore)
            run.handled = (run.handled ?? 0) + 1
          }
          for (const question of pendingQuestions) {
            seen.add(question.id)
            if (task.permission === "ask")
              emit(task.directory, { task: task.name, taskID: task.id, run, kind: "approval" })
            else yield* questions.reject(question.id).pipe(Effect.ignore)
          }
        }
      })

    const execute = (task: Task, run: LiveRun) =>
      instances.provide(
        { directory: task.directory },
        Effect.gen(function* () {
          const model = task.model
            ? {
                id: ModelV2.ID.make(task.model.modelID),
                providerID: ProviderV2.ID.make(task.model.providerID),
                variant: task.model.variant,
              }
            : undefined
          const session = yield* sessions.create({
            title: `Scheduled: ${task.name}`,
            agent: task.agent,
            model,
            metadata: { scheduledTask: task.id, scheduledRun: run.id },
          })
          run.sessionID = session.id
          const entry = running.get(task.id)
          if (entry) entry.sessionID = session.id
          yield* Effect.promise(() => ScheduleStore.saveRun(run))
          emit(task.directory, { task: task.name, taskID: task.id, run, kind: "started" })

          const responder = yield* Effect.forkChild(respond(task, session.id, run))
          const reply = yield* prompts
            .prompt({
              sessionID: session.id,
              agent: task.agent,
              model: model ? { providerID: model.providerID, modelID: model.id } : undefined,
              variant: task.model?.variant,
              parts: [{ type: "text", text: task.prompt }],
            })
            .pipe(
              Effect.timeoutOrElse({
                duration: Duration.minutes(task.timeoutMinutes),
                orElse: () =>
                  prompts.cancel(session.id).pipe(Effect.andThen(Effect.fail(new Error("timeout" as const)))),
              }),
              Effect.ensuring(Fiber.interrupt(responder)),
            )
          const info = reply.info as { role?: string; error?: { name?: string; data?: { message?: string } } }
          if (info.role === "assistant" && info.error) throw new Error(info.error.data?.message ?? info.error.name)
        }),
      )

    const start = (task: Task, reason: Run["reason"]) =>
      Effect.gen(function* () {
        const run: LiveRun = {
          id: randomUUID(),
          taskID: task.id,
          reason,
          started: Date.now(),
          status: "running",
          directory: task.directory,
        }
        yield* Effect.promise(() => ScheduleStore.saveRun(run))
        const fiber = yield* execute(task, run).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.gen(function* () {
              const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
              const message = error instanceof Error ? error.message : error === undefined ? undefined : String(error)
              // A stop request aborts the session first, which can end the prompt with an error.
              const interrupted =
                running.get(task.id)?.stopped === true || (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
              const finished: Run = {
                ...run,
                finished: Date.now(),
                status: interrupted
                  ? "cancelled"
                  : Exit.isSuccess(exit)
                    ? "success"
                    : message === "timeout"
                      ? "timeout"
                      : "failed",
                ...(message && !interrupted && message !== "timeout" && { error: message }),
                ...(message === "timeout" && { error: `Stopped after ${task.timeoutMinutes} minutes` }),
              }
              running.delete(task.id)
              yield* Effect.promise(() => ScheduleStore.saveRun(finished))
              if (task.notify)
                emit(task.directory, { task: task.name, taskID: task.id, run: finished, kind: "finished" })
            }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
        running.set(task.id, { fiber, run })
      })

    const record = (task: Task, status: "missed" | "skipped", error: string) =>
      Effect.promise(() =>
        ScheduleStore.saveRun({
          id: randomUUID(),
          taskID: task.id,
          reason: "schedule",
          started: task.nextRun ?? Date.now(),
          finished: Date.now(),
          status,
          directory: task.directory,
          error,
        }),
      )

    const tick = Effect.gen(function* () {
      for (const id of yield* Effect.promise(ScheduleStore.takeRequests)) {
        const task = yield* Effect.promise(() => ScheduleStore.get(id))
        if (task && !running.has(id)) yield* start(task, "manual")
      }
      const now = Date.now()
      let soonest = now + TICK
      for (const task of yield* Effect.promise(ScheduleStore.list)) {
        if (!task.enabled || task.nextRun === null) continue
        if (task.nextRun > now) {
          soonest = Math.min(soonest, task.nextRun)
          continue
        }
        const following = Schedule.next(task.trigger, now) ?? null
        yield* Effect.promise(() => ScheduleStore.setNextRun(task.id, following, following === null))
        if (following !== null) soonest = Math.min(soonest, following)
        const late = now - task.nextRun > LATE
        if (running.has(task.id)) yield* record(task, "skipped", "The previous run was still going")
        else if (late && !task.catchUp) yield* record(task, "missed", "OpenCode was not running at the scheduled time")
        else yield* start(task, late ? "catchup" : "schedule")
      }
      return soonest
    })

    const loop = Effect.gen(function* () {
      let owner = false
      while (true) {
        const held = yield* Effect.promise(holdLock).pipe(Effect.orElseSucceed(() => false))
        if (held && !owner) yield* Effect.promise(ScheduleStore.closeOrphans)
        owner = held
        const soonest = held
          ? yield* tick.pipe(
              Effect.catchCause((cause) =>
                Effect.logError("scheduled task tick failed", { cause }).pipe(Effect.as(Date.now() + TICK)),
              ),
            )
          : Date.now() + TICK
        yield* waitForChange(Math.min(soonest - Date.now(), TICK))
      }
    })

    yield* Effect.forkIn(loop, scope)
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        const current = await readFile(lockFile(), "utf8").catch(() => "")
        if (current.includes(`"pid":${process.pid},`)) await rm(lockFile(), { force: true })
      }),
    )

    return Service.of({
      active: () => Effect.sync(() => [...running.keys()]),
      cancel: (taskID) =>
        Effect.gen(function* () {
          const entry = running.get(taskID)
          if (!entry) return false
          entry.stopped = true
          if (entry.sessionID)
            yield* instances
              .provide({ directory: entry.run.directory }, prompts.cancel(SessionID.make(entry.sessionID)))
              .pipe(Effect.ignore)
          yield* Fiber.interrupt(entry.fiber)
          return true
        }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [InstanceStore.node, Session.node, SessionPrompt.node, Permission.node, Question.node],
})

export * as ScheduleRunner from "./runner"
