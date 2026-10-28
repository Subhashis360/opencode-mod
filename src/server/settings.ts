export * as ModSettings from "./settings.js"

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Path } from "./paths.js"

// Settings only OpenCode Mod understands, so they live beside the config file instead of in it: an OpenCode that
// reads the same config never sees an unknown key.
export type Settings = {
  /** The computer tool: the agent sees and controls desktop apps and Android phones. Off until the user opts in. */
  readonly computerUse: boolean
  /** The desktop app stays in the tray when its window closes, so scheduled tasks keep running. */
  readonly stayInTray: boolean
  /** The desktop app starts in the tray when the user signs in. */
  readonly openAtLogin: boolean
  /** OpenCode Mod checks GitHub when the app starts and installs an update in the background. On until turned off. */
  readonly autoUpdate: boolean
}

export const DEFAULTS: Settings = { computerUse: false, stayInTray: true, openAtLogin: false, autoUpdate: true }

export const file = () => path.join(Path.config, "opencode-mod.json")

export async function load(target = file()): Promise<Settings> {
  const parsed: unknown = await readFile(target, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  if (!parsed || typeof parsed !== "object") return DEFAULTS
  const value = parsed as Record<string, unknown>
  return {
    computerUse: value.computerUse === true,
    stayInTray: value.stayInTray !== false,
    openAtLogin: value.openAtLogin === true,
    autoUpdate: value.autoUpdate !== false,
  }
}

export async function save(input: Partial<Settings>, target = file()) {
  const next: Settings = { ...(await load(target)), ...input }
  await mkdir(path.dirname(target), { recursive: true })
  // Written to a temporary file first, so a crash never leaves half a file.
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(next, null, 2) + "\n")
  await rename(temp, target)
  return next
}
