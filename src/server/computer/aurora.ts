import { mkdir, readFile, rename, writeFile } from "fs/promises"
import path from "path"
import { Path } from "../paths.js"
import { ComputerDriver } from "./driver"

// OpenCode Mod: a glow around the screens while the agent is using the computer, so it is always clear when the
// agent is in control. It turns on with the first desktop action and off when the session goes idle, or after a
// quiet minute. The helper keeps it out of the agent's own screenshots.
// The same file holds the other live computer use setting: background, which keeps the agent off the user's mouse.

export type Settings = { enabled: boolean; color?: string; background: boolean }

// Cyan, violet, pink and amber flowing around the edges.
export const DEFAULT_COLORS = [0x22d3ee, 0x8b5cf6, 0xec4899, 0xf59e0b]
const COLOR = /^#[0-9a-f]{6}$/i
const QUIET_MS = 60_000

export const file = () => path.join(Path.data, "mod-aurora.json")

export async function load(): Promise<Settings> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as Partial<Settings>
    return {
      enabled: parsed.enabled !== false,
      ...(typeof parsed.color === "string" && COLOR.test(parsed.color) ? { color: parsed.color.toLowerCase() } : {}),
      background: parsed.background === true,
    }
  } catch {
    return { enabled: true, background: false }
  }
}

/** Saves the settings; a missing color means the default palette, and a missing background keeps the saved one. */
export async function save(input: Omit<Settings, "background"> & { background?: boolean }) {
  if (input.color !== undefined && !COLOR.test(input.color)) throw new Error("The color must look like #22d3ee")
  const data: Settings = {
    enabled: input.enabled,
    ...(input.color ? { color: input.color.toLowerCase() } : {}),
    background: input.background ?? (await load()).background,
  }
  await mkdir(path.dirname(file()), { recursive: true })
  const temp = `${file()}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2))
  await rename(temp, file())
  // A glow that is showing picks up the new color, or goes away, right away.
  if (active.size > 0) void show(data)
  return data
}

export function colors(settings: Settings) {
  return settings.color ? [parseInt(settings.color.slice(1), 16)] : DEFAULT_COLORS
}

export type Area = { x: number; y: number; width: number; height: number }

const active = new Set<string>()
let quiet: ReturnType<typeof setTimeout> | undefined
let shown = false
// Where the agent last worked: the app window it is in, outlined while it is on screen, and its display otherwise.
let area: Area | undefined
let window: number | undefined

async function show(settings: Settings) {
  if (!settings.enabled || active.size === 0) return hide()
  shown = true
  const at = area ? { x: area.x, y: area.y, width: area.width, height: area.height } : {}
  await ComputerDriver.call("aurora", { on: true, colors: colors(settings), hwnd: window ?? 0, ...at }).catch(() => {
    shown = false
  })
}

function hide() {
  if (!shown) return
  shown = false
  void ComputerDriver.call("aurora", { on: false }).catch(() => {})
}

/**
 * A desktop action runs for this session on `display`, in the app window `hwnd` when there is one: show the glow
 * around that window (or the display) and keep it up.
 */
export function hold(sessionID: string, display?: Area, hwnd?: number) {
  if (!ComputerDriver.supported()) return
  active.add(sessionID)
  if (display) area = display
  window = hwnd
  if (quiet) clearTimeout(quiet)
  quiet = setTimeout(() => {
    active.clear()
    hide()
  }, QUIET_MS)
  quiet.unref?.()
  // Sent on every action, so a helper that restarted in between shows the glow again.
  void load().then(show)
}

/** The session stopped working. The glow goes once no session is using the computer. */
export function release(sessionID: string) {
  if (!active.delete(sessionID) || active.size > 0) return
  if (quiet) clearTimeout(quiet)
  quiet = undefined
  hide()
}

export * as ComputerAurora from "./aurora"
