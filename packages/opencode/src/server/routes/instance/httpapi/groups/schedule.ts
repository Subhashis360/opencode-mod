import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Schedule } from "@/schedule/schedule"
import { described } from "./metadata"

// OpenCode Mod: scheduled tasks. Validation problems come back as { success: false, error } so the
// app can show the reason next to the field.

const ScheduleList = Schema.Struct({
  tasks: Schema.Array(Schedule.Task),
  active: Schema.Array(Schema.String).annotate({ description: "IDs of tasks running right now" }),
}).annotate({ identifier: "ScheduleList" })

const ScheduleResult = Schema.Union([
  Schema.Struct({ success: Schema.Literal(true), task: Schedule.Task }),
  Schema.Struct({ success: Schema.Literal(false), error: Schema.String }),
]).annotate({ identifier: "ScheduleResult" })

export const ScheduleIDInput = Schema.Struct({ id: Schema.String })
export const ScheduleUpdateInput = Schema.Struct({ id: Schema.String, patch: Schedule.TaskPatch })
export const ScheduleRunsInput = Schema.Struct({ taskID: Schema.optional(Schema.String) })

export const SchedulePaths = {
  list: "/global/mod/schedule",
  create: "/global/mod/schedule/create",
  update: "/global/mod/schedule/update",
  remove: "/global/mod/schedule/remove",
  run: "/global/mod/schedule/run",
  cancel: "/global/mod/schedule/cancel",
  runs: "/global/mod/schedule/runs",
} as const

const endpoint = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({ identifier, summary, description })

export const ScheduleApi = HttpApi.make("schedule").add(
  HttpApiGroup.make("schedule")
    .add(
      HttpApiEndpoint.get("list", SchedulePaths.list, {
        success: described(ScheduleList, "Scheduled tasks"),
      }).annotateMerge(
        endpoint("global.mod.scheduleList", "List scheduled tasks", "Every scheduled task with its next and last run."),
      ),
      HttpApiEndpoint.post("create", SchedulePaths.create, {
        payload: Schedule.TaskInput,
        success: described(ScheduleResult, "Created task or the reason it was refused"),
      }).annotateMerge(
        endpoint("global.mod.scheduleCreate", "Create a scheduled task", "Add a task that runs on a schedule."),
      ),
      HttpApiEndpoint.post("update", SchedulePaths.update, {
        payload: ScheduleUpdateInput,
        success: described(ScheduleResult, "Updated task or the reason it was refused"),
      }).annotateMerge(
        endpoint("global.mod.scheduleUpdate", "Update a scheduled task", "Change any field, pause or resume a task."),
      ),
      HttpApiEndpoint.post("remove", SchedulePaths.remove, {
        payload: ScheduleIDInput,
        success: described(Schema.Boolean, "Removed"),
      }).annotateMerge(
        endpoint("global.mod.scheduleRemove", "Delete a scheduled task", "Delete a task and its run history."),
      ),
      HttpApiEndpoint.post("run", SchedulePaths.run, {
        payload: ScheduleIDInput,
        success: described(Schema.Boolean, "Queued"),
      }).annotateMerge(
        endpoint(
          "global.mod.scheduleRun",
          "Run a scheduled task now",
          "Start the task now without changing its schedule.",
        ),
      ),
      HttpApiEndpoint.post("cancel", SchedulePaths.cancel, {
        payload: ScheduleIDInput,
        success: described(Schema.Boolean, "Whether a run was stopped"),
      }).annotateMerge(endpoint("global.mod.scheduleCancel", "Stop a running task", "Stop the task's current run.")),
      HttpApiEndpoint.post("runs", SchedulePaths.runs, {
        payload: ScheduleRunsInput,
        success: described(Schema.Array(Schedule.Run), "Recent runs, newest first"),
      }).annotateMerge(
        endpoint("global.mod.scheduleRuns", "List scheduled task runs", "Recent runs of one task, or of all tasks."),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "schedule", description: "Scheduled task routes." })),
)
