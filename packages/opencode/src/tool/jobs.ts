import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { BackgroundShell } from "@/mod/background-shell"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "output", "stop"]),
  id: Schema.optional(Schema.String).annotate({ description: "Job id for output and stop" }),
  lines: Schema.optional(Schema.Number).annotate({ description: "output: how many trailing lines (default 50)" }),
})

const DESCRIPTION = `Manages background shell jobs started with the bash tool's run_in_background option.
- list: jobs in this session with their status and log file
- output: the last lines a job printed (id, lines)
- stop: stop a running job and its child processes (id)
You are woken automatically when a job finishes (and when it prints a notify_on match), so do not poll.`

export const JobsTool = Tool.define(
  "jobs",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        if (params.action === "list") {
          const jobs = BackgroundShell.list(ctx.sessionID)
          const text = jobs
            .map(
              (job) =>
                `${job.id} | ${job.status}${job.code !== undefined ? ` (exit ${job.code})` : ""} | ${job.command} | ${job.log}`,
            )
            .join("\n")
          return { title: `${jobs.length} background jobs`, output: text || "No background jobs.", metadata: {} }
        }
        if (!params.id) throw new Error(`${params.action} needs the job id`)
        if (params.action === "output") {
          const text = yield* Effect.promise(() => BackgroundShell.output(params.id!, params.lines ?? 50))
          return { title: `Output of ${params.id}`, output: text || "(no output yet)", metadata: {} }
        }
        const stopped = BackgroundShell.stop(params.id)
        return {
          title: stopped ? `Stopped ${params.id}` : `${params.id} already ended`,
          output: stopped ? "Stopped." : "The job had already ended.",
          metadata: {},
        }
      }).pipe(Effect.orDie),
  } satisfies Tool.DefWithoutID<typeof Parameters>),
)
