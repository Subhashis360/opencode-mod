// Pure helpers for the Mod settings, kept free of Solid so they can be unit tested.

/** Names of agents, commands and MCP servers: what the config file and the slash command menu accept. */
export const ENTRY_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export type Effect = "allow" | "ask" | "deny"

export const EFFECTS: readonly Effect[] = ["allow", "ask", "deny"]

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: Effect
}

/** OpenCode 2's permission actions: a tool's name, or the permission it shares (edit covers write and patch). */
export const ACTIONS = [
  "read",
  "edit",
  "glob",
  "grep",
  "shell",
  "subagent",
  "webfetch",
  "websearch",
  "browser",
  "computer",
  "external_directory",
  "skill",
  "todowrite",
  "question",
  "doom_loop",
] as const

export type Preset = "audit" | "safe" | "balanced" | "auto"

export const PRESETS: readonly Preset[] = ["audit", "safe", "balanced", "auto"]

const READ = { read: "allow", glob: "allow", grep: "allow" } as const

// Rules are last-match-wins, so the wildcard comes first and the specific actions after it.
const PRESET_EFFECTS: Record<Preset, Record<string, Effect>> = {
  audit: {
    "*": "ask",
    ...READ,
    subagent: "allow",
    todowrite: "allow",
    question: "allow",
    edit: "deny",
    shell: "deny",
    computer: "deny",
    external_directory: "deny",
  },
  safe: { "*": "ask", ...READ, subagent: "allow", todowrite: "allow", question: "allow", websearch: "allow" },
  balanced: { "*": "allow", shell: "ask", computer: "ask", external_directory: "ask", doom_loop: "ask" },
  auto: { "*": "allow", external_directory: "allow", doom_loop: "allow" },
}

export function preset(name: Preset): Rule[] {
  return Object.entries(PRESET_EFFECTS[name]).map(([action, effect]) => ({ action, resource: "*", effect }))
}

export function isEffect(value: unknown): value is Effect {
  return value === "allow" || value === "ask" || value === "deny"
}

/** The rules in the config file that this editor understands; anything else is kept as it is. */
export function parseRules(value: unknown): Rule[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): Rule[] => {
    if (!isPlainObject(item)) return []
    const { action, resource, effect } = item

    if (typeof action !== "string" || typeof resource !== "string" || !isEffect(effect)) return []

    return [{ action, resource, effect }]
  })
}

/** What each action does for any resource, as the table shows it: the last rule for "*" resources wins. */
export function effects(rules: readonly Rule[]) {
  const result: Record<string, Effect> = {}

  for (const rule of rules) if (rule.resource === "*") result[rule.action] = rule.effect

  return result
}

/**
 * Sets what an action does for every resource. Rules for specific resources (paths, commands) stay where they are, so
 * they keep overriding the default after it.
 */
export function setEffect(rules: readonly Rule[], action: string, effect: Effect | undefined): Rule[] {
  const kept = rules.filter((rule) => !(rule.action === action && rule.resource === "*"))

  if (!effect) return kept
  const rule = { action, resource: "*", effect }

  // The wildcard action must stay before every specific one, or it would override them.
  if (action === "*") return [rule, ...kept]
  const firstSpecific = kept.findIndex((item) => item.action === action && item.resource !== "*")

  if (firstSpecific === -1) return [...kept, rule]

  return [...kept.slice(0, firstSpecific), rule, ...kept.slice(firstSpecific)]
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function record(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainObject(value)) return {}

  return Object.fromEntries(Object.entries(value).filter((entry) => isPlainObject(entry[1]))) as Record<
    string,
    Record<string, unknown>
  >
}

/** Drops empty strings and undefined so the config file only gets the fields the user filled in. */
export function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as Partial<T>
}

export function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** A config model: "provider/model" or `{ providerID, modelID }`. */
export function modelText(value: unknown) {
  if (typeof value === "string") return value

  if (isPlainObject(value) && typeof value.providerID === "string" && typeof value.modelID === "string")
    return `${value.providerID}/${value.modelID}`

  return ""
}

export function validModel(value: string) {
  return value === "" || /^[^/\s]+\/\S+$/.test(value)
}

/** Splits a command line into arguments; double or single quotes keep spaces inside one argument. */
export function splitCommand(line: string) {
  const args: string[] = []
  let current = ""
  let quote: string | undefined
  let started = false

  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }

    if (/\s/.test(char)) {
      if (started) args.push(current)
      current = ""
      started = false
      continue
    }

    current += char
    started = true
  }

  if (started) args.push(current)

  return args
}

export function joinCommand(args: readonly string[]) {
  return args.map((arg) => (arg === "" || /\s/.test(arg) ? `"${arg}"` : arg)).join(" ")
}

/** `NAME=value` lines, as the MCP editor shows environment variables and headers. */
export function parsePairs(lines: string) {
  const result: Record<string, string> = {}

  for (const line of lines.split(/\r?\n/)) {
    const index = line.indexOf("=")

    if (index <= 0) continue
    const name = line.slice(0, index).trim()

    if (name) result[name] = line.slice(index + 1).trim()
  }

  return result
}

export function formatPairs(value: unknown) {
  if (!isPlainObject(value)) return ""

  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, item]) => `${name}=${item}`)
    .join("\n")
}

/** A preset replaces what every action does for any resource; rules for specific resources stay after it. */
export function applyPreset(rules: readonly Rule[], name: Preset) {
  return preset(name).reduce(
    (result: Rule[], item) => setEffect(result, item.action, item.effect),
    rules.filter((item) => item.resource !== "*"),
  )
}
