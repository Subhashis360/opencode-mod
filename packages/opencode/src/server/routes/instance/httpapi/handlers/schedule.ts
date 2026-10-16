import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ScheduleRunner } from "@/schedule/runner"
import { ScheduleStore } from "@/schedule/store"
import { errorMessage } from "@/util/error"
import { RootHttpApi } from "../api"
import { ScheduleIDInput, ScheduleRunsInput, ScheduleUpdateInput } from "../groups/schedule"
import type { Schedule } from "@/schedule/schedule"

const result = (work: () => Promise<Schedule.Task>) =>
  Effect.promise(() =>
    work().then(
      (task) => ({ success: true as const, task }),
      (error: unknown) => ({ success: false as const, error: errorMessage(error) }),
    ),
  )

export const scheduleHandlers = HttpApiBuilder.group(RootHttpApi, "schedule", (handlers) =>
  Effect.gen(function* () {
    // Yielding the runner here starts it together with the server.
    const runner = yield* ScheduleRunner.Service

    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          return { tasks: yield* Effect.promise(ScheduleStore.list), active: yield* runner.active() }
        }),
      )
      .handle("create", (ctx: { payload: Schedule.TaskInput }) => result(() => ScheduleStore.create(ctx.payload)))
      .handle("update", (ctx: { payload: typeof ScheduleUpdateInput.Type }) =>
        result(() => ScheduleStore.update(ctx.payload.id, ctx.payload.patch)),
      )
      .handle("remove", (ctx: { payload: typeof ScheduleIDInput.Type }) =>
        runner.cancel(ctx.payload.id).pipe(Effect.andThen(Effect.promise(() => ScheduleStore.remove(ctx.payload.id)))),
      )
      .handle("run", (ctx: { payload: typeof ScheduleIDInput.Type }) =>
        Effect.promise(() => ScheduleStore.requestRun(ctx.payload.id).catch(() => false)),
      )
      .handle("cancel", (ctx: { payload: typeof ScheduleIDInput.Type }) => runner.cancel(ctx.payload.id))
      .handle("runs", (ctx: { payload: typeof ScheduleRunsInput.Type }) =>
        Effect.promise(() => ScheduleStore.runs(ctx.payload.taskID)),
      )
  }),
)
