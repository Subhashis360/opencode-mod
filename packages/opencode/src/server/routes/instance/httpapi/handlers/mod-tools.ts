import os from "os"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ModHooks } from "@/mod/hooks"
import { ModMemory } from "@/mod/memory"
import { errorMessage } from "@/util/error"
import { RootHttpApi } from "../api"
import { HookSaveInput, HookTestInput, MemoryEnabledInput, MemoryIDInput, MemorySaveInput } from "../groups/mod-tools"

const failure = (error: unknown) => ({ success: false as const, error: errorMessage(error) })

export const modToolsHandlers = HttpApiBuilder.group(RootHttpApi, "modTools", (handlers) =>
  Effect.succeed(
    handlers
      .handle("hooks", () => Effect.promise(ModHooks.list))
      .handle("hooksSave", (ctx: { payload: typeof HookSaveInput.Type }) =>
        Effect.promise(() =>
          ModHooks.save(ctx.payload.hooks.map((hook) => ({ ...hook, id: hook.id ?? "" }))).then(
            (hooks) => ({ success: true as const, hooks }),
            failure,
          ),
        ),
      )
      .handle("hooksTest", (ctx: { payload: typeof HookTestInput.Type }) =>
        Effect.promise(() =>
          ModHooks.run(
            ctx.payload.command,
            { event: ctx.payload.event, test: true, tool: "bash", input: { command: "echo hello" }, prompt: "hello" },
            {
              cwd: ctx.payload.directory ?? os.homedir(),
              timeout: 30,
              env: { OPENCODE_HOOK_EVENT: ctx.payload.event },
            },
          ),
        ),
      )
      .handle("memory", () => Effect.promise(ModMemory.load))
      .handle("memorySave", (ctx: { payload: typeof MemorySaveInput.Type }) =>
        Effect.promise(() => ModMemory.save(ctx.payload).then((entry) => ({ success: true as const, entry }), failure)),
      )
      .handle("memoryRemove", (ctx: { payload: typeof MemoryIDInput.Type }) =>
        Effect.promise(() => ModMemory.remove(ctx.payload.id)),
      )
      .handle("memoryEnabled", (ctx: { payload: typeof MemoryEnabledInput.Type }) =>
        Effect.promise(() => ModMemory.setEnabled(ctx.payload.enabled)).pipe(Effect.as(true)),
      ),
  ),
)
