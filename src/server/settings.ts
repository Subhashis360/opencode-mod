export * as ModSettings from "./settings.js"

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Path } from "./paths.js"

// Settings only OpenCode Mod understands, so they live beside the config file instead of in it: an OpenCode that
// reads the same config never sees an unknown key.

/** The local code index and the codebase tool built on it. */
export type CodeIndex = {
  readonly enabled: boolean
  /** Optional meaning-based ranking from an OpenAI-compatible /embeddings endpoint. */
  readonly embeddings: { readonly enabled: boolean; readonly baseURL: string; readonly apiKey: string; readonly model: string }
}

/** Push-to-talk: a global shortcut records the microphone and an OpenAI-compatible endpoint transcribes it. */
export type Voice = {
  readonly enabled: boolean
  /** An Electron accelerator, e.g. CommandOrControl+Shift+Space. */
  readonly shortcut: string
  readonly baseURL: string
  readonly apiKey: string
  readonly model: string
  /** ISO-639-1 code such as en; empty lets the model detect it. */
  readonly language: string
  /** Send the transcript at once instead of leaving it in the message box. */
  readonly autoSend: boolean
  /** Read the agent's answer to a spoken message aloud. */
  readonly speakReplies: boolean
  readonly rate: number
}

export type Settings = {
  /** The computer tool: the agent sees and controls desktop apps and Android phones. Off until the user opts in. */
  readonly computerUse: boolean
  /** The desktop app stays in the tray when its window closes, so scheduled tasks keep running. */
  readonly stayInTray: boolean
  /** The desktop app starts in the tray when the user signs in. */
  readonly openAtLogin: boolean
  /** OpenCode Mod checks GitHub when the app starts and installs an update in the background. On until turned off. */
  readonly autoUpdate: boolean
  readonly codeIndex: CodeIndex
  readonly voice: Voice
}

export const DEFAULTS: Settings = {
  computerUse: false,
  stayInTray: true,
  openAtLogin: false,
  autoUpdate: true,
  codeIndex: {
    enabled: true,
    embeddings: { enabled: false, baseURL: "http://localhost:11434/v1", apiKey: "", model: "nomic-embed-text" },
  },
  voice: {
    enabled: false,
    shortcut: "CommandOrControl+Shift+Space",
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: "",
    model: "whisper-large-v3-turbo",
    language: "",
    autoSend: false,
    speakReplies: false,
    rate: 1,
  },
}

export const file = () => path.join(Path.config, "opencode-mod.json")

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const string = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback)

function codeIndex(input: unknown): CodeIndex {
  const value = object(input)
  const embeddings = object(value.embeddings)
  const base = DEFAULTS.codeIndex.embeddings
  return {
    enabled: value.enabled !== false,
    embeddings: {
      enabled: embeddings.enabled === true,
      baseURL: string(embeddings.baseURL, base.baseURL),
      apiKey: string(embeddings.apiKey, base.apiKey),
      model: string(embeddings.model, base.model),
    },
  }
}

function voice(input: unknown): Voice {
  const value = object(input)
  const base = DEFAULTS.voice
  const rate = typeof value.rate === "number" && value.rate >= 0.5 && value.rate <= 2 ? value.rate : base.rate
  return {
    enabled: value.enabled === true,
    shortcut: string(value.shortcut, base.shortcut) || base.shortcut,
    baseURL: string(value.baseURL, base.baseURL),
    apiKey: string(value.apiKey, base.apiKey),
    model: string(value.model, base.model),
    language: string(value.language, base.language),
    autoSend: value.autoSend === true,
    speakReplies: value.speakReplies === true,
    rate,
  }
}

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
    codeIndex: codeIndex(value.codeIndex),
    voice: voice(value.voice),
  }
}

export async function save(input: Partial<Settings>, target = file()) {
  const current = await load(target)
  const next: Settings = {
    ...current,
    ...input,
    // Nested settings are normalized, so a partial write never drops a field.
    codeIndex: codeIndex(input.codeIndex ?? current.codeIndex),
    voice: voice(input.voice ?? current.voice),
  }
  await mkdir(path.dirname(target), { recursive: true })
  // Written to a temporary file first, so a crash never leaves half a file.
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(next, null, 2) + "\n")
  await rename(temp, target)
  return next
}
