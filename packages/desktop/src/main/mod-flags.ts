import { getStore } from "./store"

// The Mod settings' Experimental tab saves engine switches here; they are read when the local
// server starts, because the engine reads them from its environment at startup.
export const MOD_STORE = "opencode.mod"
export const MOD_FLAGS_KEY = "experimentalFlags"

// Only engine feature switches with plain values are accepted, so this store can never be used
// to inject arbitrary environment variables (PATH, NODE_OPTIONS, credentials...) into the server.
const FLAG_NAME = /^OPENCODE_(EXPERIMENTAL|ENABLE)_[A-Z0-9_]+$|^OPENCODE_EXPERIMENTAL$/
const FLAG_VALUE = /^[A-Za-z0-9._-]{1,32}$/

export function parseModFlags(raw: unknown): Record<string, string> {
  if (typeof raw !== "string") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        FLAG_NAME.test(entry[0]) && typeof entry[1] === "string" && FLAG_VALUE.test(entry[1]),
    ),
  )
}

export function readModFlags() {
  try {
    return parseModFlags(getStore(MOD_STORE).get(MOD_FLAGS_KEY))
  } catch {
    return {}
  }
}
