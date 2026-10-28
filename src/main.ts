import { watch } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin/gui"
import { app, BrowserWindow, Menu, Notification, Tray, type Event } from "electron"
import { ScheduleRunner } from "./server/schedule/runner"
import { ModSettings } from "./server/settings"
import { setupUpdates } from "./update/main"
import { setupVoice } from "./voice/main"

/** Added to the sign-in launch, which starts in the tray only. */
const HIDDEN = "--hidden"

function iconPath() {
  const name = process.platform === "win32" ? "icon.ico" : "icon.png"

  return app.isPackaged
    ? path.join(process.resourcesPath, "icons", name)
    : path.join(app.getAppPath(), "resources", "icons", name)
}

// OpenCode Mod in the desktop app's main process: scheduled tasks run from here, and the app can stay in the tray with
// no window open, because the server unloads idle projects and the runner must keep going.
const main: Plugin.MainSetup = (ctx) => {
  let tray: Tray | undefined
  let quitting = false
  let hinted = false
  let settings = ModSettings.DEFAULTS

  const open = () => {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())

    if (!window) {
      // With every window closed, a new one is opened as on a fresh start.
      app.emit("activate")

      return
    }

    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const quit = () => {
    quitting = true
    app.quit()
  }

  const syncTray = () => {
    if (!settings.stayInTray) {
      tray?.destroy()
      tray = undefined

      return
    }

    if (tray) return
    tray = new Tray(iconPath())
    tray.setToolTip(app.getName())
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: ctx.t("tray.open", { app: app.getName() }), click: open },
        { type: "separator" },
        { label: ctx.t("tray.quit"), click: quit },
      ]),
    )
    tray.on("click", open)
  }

  const syncLogin = () => {
    if (process.platform === "linux" || !app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: [HIDDEN] })
  }

  const apply = async () => {
    settings = await ModSettings.load().catch(() => ModSettings.DEFAULTS)
    if (ctx.signal.aborted) return
    syncTray()
    syncLogin()
  }

  // The app quits when its last window closes. While the tray is up, closing the last visible window hides it
  // instead, so the app keeps running; the first time, a notification says so.
  const hide = (window: BrowserWindow) => (event: Event) => {
    if (quitting || !tray) return
    const others = BrowserWindow.getAllWindows().some(
      (item) => item !== window && !item.isDestroyed() && item.isVisible(),
    )
    if (others) return

    event.preventDefault()
    window.hide()

    if (!hinted && Notification.isSupported()) {
      hinted = true
      new Notification({
        title: ctx.t("tray.hint.title", { app: app.getName() }),
        body: ctx.t("tray.hint.body"),
        silent: true,
      }).show()
    }
  }

  const guard = (window: BrowserWindow) => {
    const listener = hide(window)
    window.on("close", listener)
    ctx.onCleanup(() => {
      if (!window.isDestroyed()) window.off("close", listener)
    })
  }

  for (const window of ctx.windows.list()) guard(window)
  ctx.onCleanup(ctx.windows.on("open", guard))

  const beforeQuit = () => {
    quitting = true
  }

  app.on("before-quit", beforeQuit)
  ctx.onCleanup(() => {
    app.off("before-quit", beforeQuit)
    tray?.destroy()
    tray = undefined
  })

  void apply().then(() => {
    // A sign-in launch hides the windows the app restored, so it starts in the tray.
    if (process.argv.includes(HIDDEN) && tray) for (const window of BrowserWindow.getAllWindows()) window.hide()
  })

  // The Mod settings change the same file through the server; follow it.
  try {
    const watcher = watch(path.dirname(ModSettings.file()), (_, name) => {
      if (name === path.basename(ModSettings.file())) void apply()
    })

    watcher.on("error", () => undefined)
    ctx.onCleanup(() => watcher.close())
  } catch {
    // No config folder yet: the settings are the defaults until the app restarts.
  }

  const notify = (event: ScheduleRunner.RunEvent) => {
    if (event.kind !== "finished" || !Notification.isSupported()) return

    const status =
      event.run.status === "success" ? "success" : event.run.status === "cancelled" ? "cancelled" : "failed"

    const notification = new Notification({
      title: ctx.t(`schedule.notification.${status}`, { task: event.task }),
      body: event.run.error ?? ctx.t("schedule.notification.body"),
    })

    notification.on("click", open)
    notification.show()
  }

  const runner = ScheduleRunner.start({
    client: () => ctx.client,
    notify,
    log: (message, data) => ctx.log.write("warn", message, data),
  })

  ctx.onCleanup(() => runner.close())

  setupUpdates(ctx)
  setupVoice(ctx)
}

export default main
