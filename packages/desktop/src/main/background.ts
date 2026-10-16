import { app, BrowserWindow, Menu, Notification, Tray } from "electron"
import { MOD } from "./constants"
import { MOD_STORE } from "./mod-flags"
import { getStore } from "./store"

// OpenCode Mod: keep running in the tray so scheduled tasks fire with the window closed, start at
// sign-in, and show native notifications for scheduled runs. Settings → Mod → Scheduled writes
// these keys to the "opencode.mod" store.

type Server = { url: string; username: string; password: string }
type RunEvent = {
  task: string
  kind: "started" | "finished" | "approval"
  run: { status: string; error?: string }
}

export const HIDDEN_ARG = "--hidden"

let tray: Tray | undefined
let quitting = false
let hintShown = false

const store = () => getStore(MOD_STORE)
export const backgroundEnabled = () => MOD && store().get("backgroundMode") !== "false"
export const startedHidden = () => process.argv.includes(HIDDEN_ARG)
export const markQuitting = () => {
  quitting = true
}

function applyLoginItem() {
  if (!MOD || process.platform === "linux" || !app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: store().get("openAtLogin") === "true", args: [HIDDEN_ARG] })
}

function syncTray(icon: string, open: () => void) {
  if (!backgroundEnabled()) {
    tray?.destroy()
    tray = undefined
    return
  }
  if (tray) return
  tray = new Tray(icon)
  tray.setToolTip(app.getName())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${app.getName()}`, click: open },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on("click", open)
  tray.on("double-click", open)
}

export function setupBackground(input: { icon: string; open: () => void }) {
  if (!MOD) return
  applyLoginItem()
  syncTray(input.icon, input.open)
  store().onDidChange("openAtLogin", applyLoginItem)
  store().onDidChange("backgroundMode", () => syncTray(input.icon, input.open))
}

/** Called from window-all-closed: true when the app should stay alive in the tray. */
export function stayInTray() {
  if (quitting || !backgroundEnabled() || !tray) return false
  if (!hintShown && Notification.isSupported()) {
    hintShown = true
    new Notification({
      title: `${app.getName()} is still running`,
      body: "Scheduled tasks keep running. Quit from the tray icon.",
      silent: true,
    }).show()
  }
  return true
}

function show(event: RunEvent, open: () => void) {
  if (!Notification.isSupported()) return
  const focused = BrowserWindow.getFocusedWindow()
  if (event.kind === "started") return
  if (event.kind === "finished" && focused && event.run.status === "success") return
  const title =
    event.kind === "approval"
      ? `Scheduled task needs approval: ${event.task}`
      : event.run.status === "success"
        ? `Scheduled task finished: ${event.task}`
        : `Scheduled task ${event.run.status}: ${event.task}`
  const notification = new Notification({ title, body: event.run.error ?? "", silent: event.kind === "finished" })
  notification.on("click", open)
  notification.show()
}

/** Follows the server's event stream for scheduled-run events, reconnecting until the app quits. */
export function watchScheduleEvents(server: Server, open: () => void) {
  if (!MOD) return
  const auth = `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
  const connect = async () => {
    while (!quitting) {
      try {
        const response = await fetch(`${server.url}/global/event`, { headers: { authorization: auth } })
        if (!response.body) throw new Error("no event stream")
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ""
        while (!quitting) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += value
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.startsWith("data:") || !line.includes("mod.schedule.run")) continue
            try {
              const event = JSON.parse(line.slice(5)) as { payload?: { type?: string; properties?: RunEvent } }
              if (event.payload?.type === "mod.schedule.run" && event.payload.properties)
                show(event.payload.properties, open)
            } catch {}
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  void connect()
}
