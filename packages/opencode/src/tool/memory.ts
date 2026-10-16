import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./memory.txt"
import { InstanceState } from "@/effect/instance-state"
import { ModMemory } from "@/mod/memory"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["save", "update", "forget", "list"]),
  text: Schema.optional(Schema.String).annotate({ description: "save/update: one short, self-contained fact" }),
  scope: Schema.optional(Schema.Literals(["global", "project"])).annotate({
    description: "global: about the user, applies everywhere. project: only for this project. Default project",
  }),
  id: Schema.optional(Schema.String).annotate({ description: "update/forget: the entry id shown in <memory>" }),
})

export const MemoryTool = Tool.define(
  "memory",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const data = yield* Effect.promise(ModMemory.load)
          if (!data.enabled)
            return { title: "Memory is off", output: "The user turned memory off in Settings.", metadata: {} }
          const scope = params.scope ?? "project"
          switch (params.action) {
            case "list": {
              const entries = yield* Effect.promise(() => ModMemory.relevant(instance.directory))
              return {
                title: `${entries.length} memories`,
                output:
                  entries.map((entry) => `[${entry.id}] (${entry.scope}) ${entry.text}`).join("\n") ||
                  "No memories yet.",
                metadata: {},
              }
            }
            case "save":
            case "update": {
              if (!params.text) throw new Error(`${params.action} needs text`)
              if (params.action === "update" && !params.id) throw new Error("update needs the id")
              yield* ctx.ask({
                permission: "memory",
                patterns: [scope],
                always: ["*"],
                metadata: { text: params.text },
              })
              const entry = yield* Effect.promise(() =>
                ModMemory.save({
                  id: params.id,
                  text: params.text!,
                  scope,
                  project: instance.worktree || instance.directory,
                }),
              )
              return { title: "Remembered", output: `Saved [${entry.id}] (${entry.scope}) ${entry.text}`, metadata: {} }
            }
            case "forget": {
              if (!params.id) throw new Error("forget needs the id")
              const removed = yield* Effect.promise(() => ModMemory.remove(params.id!))
              return {
                title: removed ? "Forgotten" : "Not found",
                output: removed ? `Forgot ${params.id}` : `No memory ${params.id}`,
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
