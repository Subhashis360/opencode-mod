import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Builds made with OPENCODE_MOD=1 install as "OpenCode Mod": their own app id, data folder,
// URL scheme and update feed, so they sit beside an official OpenCode install instead of
// replacing it.
export const MOD = import.meta.env.OPENCODE_MOD === "1"
export const MOD_APP_ID = "ai.opencode.mod"
export const MOD_APP_NAME = "OpenCode Mod"
export const PROTOCOL = MOD ? "opencode-mod" : "opencode"

// The renderer only understands opencode:// links, so mod links are rewritten to that form.
export function normalizeDeepLink(url: string) {
  if (!MOD || !url.startsWith(`${PROTOCOL}://`)) return url
  return `opencode://${url.slice(PROTOCOL.length + 3)}`
}

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
