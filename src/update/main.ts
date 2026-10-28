import type { Plugin } from "@opencode/plugin/gui"
import { app, Notification } from "electron"
import { ModSettings } from "../server/settings"
import { Updater, type Status } from "./contract"
import { ModUpdater } from "./updater"

/** How long after start the automatic check waits, so it does not compete with the app opening. */
const DELAY = 5_000

// Kept on the main process's global object: the GUI bundle reloads after an update replaces it, the process does not,
// and the new instance must still say a restart is due.
const RESTART = Symbol.for("opencode-mod.update.restart")
const memory = globalThis as { [RESTART]?: boolean }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The updater, once per app: checks GitHub when the app starts, and serves the Updates tab of every window. */
export function setupUpdates(ctx: Parameters<Plugin.MainSetup>[0]) {
  let status: Status = { autoUpdate: ModSettings.DEFAULTS.autoUpdate, phase: "idle", restartNeeded: memory[RESTART] === true }
  let busy: Promise<unknown> | undefined

  const provider = ctx.provide(Updater, {
    state: () => status,
    check: () => run("check"),
    install: () => run("install"),
    setAutoUpdate: async (autoUpdate) => {
      await ModSettings.save({ autoUpdate })
      set({ ...status, autoUpdate })
      if (autoUpdate) void run("auto")
      return status
    },
    restart: () => {
      app.relaunch()
      app.quit()
    },
  })

  function set(next: Status) {
    status = next
    if (!ctx.signal.aborted) provider.changed()
  }

  /** Clears what the previous check found, keeping the settings and the restart notice. */
  const reset = (phase: Status["phase"]): Status => ({
    autoUpdate: status.autoUpdate,
    phase,
    restartNeeded: status.restartNeeded,
    ...(status.folder ? { folder: status.folder } : {}),
    ...(status.method ? { method: status.method } : {}),
    ...(status.installed ? { installed: status.installed } : {}),
    ...(status.latest ? { latest: status.latest } : {}),
  })

  /**
   * One check or install at a time; a call made while one runs waits for it, then runs on what it found. `auto`
   * installs only while automatic updates are on.
   */
  async function run(kind: "check" | "install" | "auto"): Promise<Status> {
    while (busy) await busy.catch(() => undefined)
    if (ctx.signal.aborted) return status

    const work = (async () => {
      const install = kind === "install" || (kind === "auto" && status.autoUpdate)
      set(reset("checking"))
      try {
        const dir = await ModUpdater.folder()
        const found = await ModUpdater.check(dir)
        if (found.phase !== "available" || !install) {
          set({ ...reset(found.phase), ...found, checked: Date.now() })
          return
        }

        set({ ...reset("installing"), ...found })
        const done = await ModUpdater.install(dir)
        // Already current means someone else (git pull, another check) brought it there; nothing new to load.
        const updated = done.installed !== found.installed
        if (updated) memory[RESTART] = true
        set({
          ...reset(updated ? "installed" : done.phase),
          ...done,
          checked: Date.now(),
          restartNeeded: status.restartNeeded || updated,
        })
        ctx.log.write("info", "OpenCode Mod updated", { from: found.installed, to: done.installed, method: done.method })

        if (updated && kind === "auto" && Notification.isSupported())
          new Notification({ title: ctx.t("update.notification.title"), body: ctx.t("update.notification.body") }).show()
      } catch (error) {
        set({ ...reset("error"), error: message(error), checked: Date.now() })
        ctx.log.write("warn", "OpenCode Mod update failed", { kind, error: message(error) })
      }
    })()

    busy = work
    try {
      await work
    } finally {
      busy = undefined
    }
    return status
  }

  void ModSettings.load()
    .catch(() => ModSettings.DEFAULTS)
    .then((settings) => {
      if (ctx.signal.aborted) return
      set({ ...status, autoUpdate: settings.autoUpdate })
      if (!settings.autoUpdate) return
      const timer = setTimeout(() => void run("auto"), DELAY)
      ctx.onCleanup(() => clearTimeout(timer))
    })
}
