import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { ComputerAurora } from "./computer/aurora.js"
import { ComputerDriver } from "./computer/driver.js"
import { ComputerPlugin } from "./computer/plugin.js"
import { ModConfig } from "./config.js"
import { ModHooks } from "./hooks.js"
import { ModMemory } from "./memory.js"
import { ModPrompts } from "./prompts.js"
import { ModProviders } from "./providers.js"
import { Mod } from "./rpc.js"
import { ModSettings } from "./settings.js"
import { SchedulePlugin } from "./schedule/plugin.js"
import { ScheduleStore } from "./schedule/store.js"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Runs an RPC handler's work and reports a thrown error to the caller as the method's `failed` error. */
const attempt = <A, E>(
  call: { readonly error: (name: "failed", message: string, data: {}) => E },
  fn: () => Promise<A>,
) => Effect.tryPromise({ try: fn, catch: (error) => call.error("failed", message(error), {}) })

// OpenCode Mod's server part: the tools and hooks, and the API its settings pages call. The app loads it from the
// plugins listed in the global opencode.json, and its GUI part with it.
export default Plugin.define({
  id: "opencode-mod",
  effect: (ctx) =>
    Effect.gen(function* () {
      // Read once at start; a change through settings.write updates it and reloads the tools.
      let settings = yield* Effect.promise(() => ModSettings.load())

      yield* ComputerPlugin.register(ctx, () => settings.computerUse)
      yield* SchedulePlugin.register(ctx)
      yield* ModHooks.register(ctx)
      yield* ModMemory.register(ctx)

      const snapshot = async (): Promise<Mod.Settings> => {
        const aurora = await ComputerAurora.load()
        // The desktop app's own settings are read fresh: it reads the same file, not this plugin's copy.
        const saved = await ModSettings.load()
        return {
          computerUse: settings.computerUse,
          stayInTray: saved.stayInTray,
          openAtLogin: saved.openAtLogin,
          computerSupported: ComputerDriver.supported(),
          aurora: {
            enabled: aurora.enabled,
            background: aurora.background,
            ...(aurora.color ? { color: aurora.color } : {}),
          },
        }
      }

      yield* ctx.rpc
        .register(Mod.Definition, {
          "config.read": (_, call) =>
            Effect.tryPromise({
              try: () => ModConfig.read(),
              catch: (error) => call.error("failed", message(error), {}),
            }),
          "config.write": (input, call) =>
            Effect.tryPromise({
              try: () => ModConfig.write(input.path, input.value),
              catch: (error) => call.error("failed", message(error), {}),
            }),
          "settings.read": (_, call) =>
            Effect.tryPromise({ try: snapshot, catch: (error) => call.error("failed", message(error), {}) }),
          "settings.write": (input, call) =>
            Effect.gen(function* () {
              const fail = (error: unknown) => call.error("failed", message(error), {})
              if (input.aurora) {
                const aurora = input.aurora
                yield* Effect.tryPromise({ try: () => ComputerAurora.save(aurora), catch: fail })
              }
              if (input.computerUse !== undefined && input.computerUse !== settings.computerUse) {
                const computerUse = input.computerUse
                settings = yield* Effect.tryPromise({ try: () => ModSettings.save({ computerUse }), catch: fail })
                if (!computerUse) ComputerDriver.stop()
                yield* ctx.tool.reload()
              }
              if (input.stayInTray !== undefined || input.openAtLogin !== undefined) {
                const desktop = {
                  ...(input.stayInTray !== undefined ? { stayInTray: input.stayInTray } : {}),
                  ...(input.openAtLogin !== undefined ? { openAtLogin: input.openAtLogin } : {}),
                }
                yield* Effect.tryPromise({ try: () => ModSettings.save(desktop), catch: fail })
              }
              return yield* Effect.tryPromise({ try: snapshot, catch: fail })
            }),
          "schedule.list": (_, call) => attempt(call, () => ScheduleStore.list()),
          "schedule.runs": (input, call) => attempt(call, () => ScheduleStore.runs(input.taskID)),
          "schedule.create": (input, call) => attempt(call, () => ScheduleStore.create(input)),
          "schedule.update": (input, call) => attempt(call, () => ScheduleStore.update(input.id, input.patch)),
          "schedule.remove": (input, call) => attempt(call, () => ScheduleStore.remove(input.id).then(() => undefined)),
          "schedule.run": (input, call) =>
            attempt(call, () => ScheduleStore.requestRun(input.id).then(() => undefined)),
          "schedule.stop": (input, call) =>
            attempt(call, () => ScheduleStore.requestStop(input.id).then(() => undefined)),
          "hooks.list": (_, call) => attempt(call, () => ModHooks.list()),
          "hooks.save": (input, call) => attempt(call, () => ModHooks.save([...input.hooks] as ModHooks.Hook[])),
          "hooks.test": (input, call) =>
            attempt(call, () =>
              ModHooks.run(
                input.command,
                { event: input.event, test: true, directory: ctx.location.directory },
                {
                  cwd: ctx.location.directory,
                  timeout: 30,
                  env: { OPENCODE_HOOK_EVENT: input.event },
                },
              ),
            ),
          "memory.read": (_, call) => attempt(call, () => ModMemory.load()),
          "memory.save": (input, call) => attempt(call, () => ModMemory.save(input)),
          "memory.remove": (input, call) => attempt(call, () => ModMemory.remove(input.id).then(() => undefined)),
          "memory.enable": (input, call) => attempt(call, () => ModMemory.setEnabled(input.enabled)),
          "prompts.upstream": (_, call) => attempt(call, () => ModPrompts.upstreamPrompts()),
          "prompts.library": (_, call) => attempt(call, () => ModPrompts.library()),
          "prompts.keep": (input, call) => attempt(call, () => ModPrompts.keep(input)),
          "prompts.drop": (input, call) => attempt(call, () => ModPrompts.drop(input.id)),
          "providers.models": (input, call) => attempt(call, () => ModProviders.fetchModels(input)),
        })
        .pipe(Effect.orDie)
    }),
})
