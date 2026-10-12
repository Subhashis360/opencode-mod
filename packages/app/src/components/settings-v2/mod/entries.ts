// Pure helpers shared by the mod settings tabs, kept free of Solid so they can be unit tested.

export const ENTRY_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export type PermissionAction = "allow" | "ask" | "deny"
export const PERMISSION_ACTIONS: PermissionAction[] = ["allow", "ask", "deny"]

export const PERMISSION_TOOLS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "webfetch",
  "websearch",
  "external_directory",
  "skill",
  "lsp",
  "todowrite",
  "question",
  "doom_loop",
] as const

export type PermissionPreset = "audit" | "safe" | "balanced" | "auto"

const READ_TOOLS = { read: "allow", glob: "allow", grep: "allow", list: "allow", lsp: "allow" } as const

// Later keys win over "*", so the wildcard always comes first.
export const PERMISSION_PRESETS: Record<PermissionPreset, Record<string, PermissionAction>> = {
  audit: {
    "*": "ask",
    ...READ_TOOLS,
    task: "allow",
    todowrite: "allow",
    question: "allow",
    edit: "deny",
    bash: "deny",
    external_directory: "deny",
  },
  safe: {
    "*": "ask",
    ...READ_TOOLS,
    task: "allow",
    todowrite: "allow",
    question: "allow",
    websearch: "allow",
  },
  balanced: { "*": "allow", bash: "ask", external_directory: "ask", doom_loop: "ask" },
  auto: { "*": "allow", external_directory: "allow", doom_loop: "allow" },
}

// Permission rules are evaluated last-match-wins, so "*" must be stored before the specific
// tools. The server decodes a patch in schema order, which moves "*" to the end, while a write
// appends keys that are new to the file after the existing ones. Writing the wildcard in its own
// patch first, then the specific tools, keeps the stored order correct.
export function permissionPatches<T>(rules: Record<string, T>): Record<string, T>[] {
  const { "*": wildcard, ...specific } = rules
  return [...(wildcard !== undefined ? [{ "*": wildcard }] : []), ...(Object.keys(specific).length ? [specific] : [])]
}

export function isAction(value: unknown): value is PermissionAction {
  return value === "allow" || value === "ask" || value === "deny"
}

// What a tool resolves to in the stored permission config. A bare string applies to every tool,
// and pattern maps (e.g. bash: { "git *": "allow" }) are reported as "custom".
export function permissionValue(config: unknown, tool: string): PermissionAction | "default" | "custom" {
  if (typeof config === "string") return isAction(config) ? config : "default"
  if (!isPlainObject(config)) return "default"
  const value = config[tool]
  if (value === undefined) return "default"
  return isAction(value) ? value : "custom"
}

// Splits a command line into arguments, keeping single- or double-quoted segments together.
export function splitCommandLine(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: string | undefined
  let started = false
  for (const char of input.trim()) {
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

export function joinCommandLine(args: readonly string[]) {
  return args
    .map((arg) => {
      if (arg !== "" && !/[\s"']/.test(arg)) return arg
      return arg.includes('"') ? `'${arg}'` : `"${arg}"`
    })
    .join(" ")
}

// Parses one "KEY<separator>VALUE" pair per line, ignoring blank lines. Reports the first
// malformed line (1-based) instead of guessing what it meant.
export function parsePairs(text: string, separator: "=" | ":") {
  const pairs: Record<string, string> = {}
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const at = line.indexOf(separator)
    const key = at > 0 ? line.slice(0, at).trim() : ""
    if (!key) return { pairs, invalidLine: i + 1 }
    pairs[key] = line.slice(at + 1).trim()
  }
  return { pairs, invalidLine: undefined }
}

export function formatPairs(pairs: Record<string, string> | undefined, separator: "=" | ":") {
  return Object.entries(pairs ?? {})
    .map(([key, value]) => (separator === ":" ? `${key}: ${value}` : `${key}=${value}`))
    .join("\n")
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Drops undefined values, empty strings and empty objects so a saved entry only holds what the
// user actually set.
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === "") continue
    if (isPlainObject(item)) {
      const inner = compact(item)
      if (Object.keys(inner).length) result[key] = inner
      continue
    }
    result[key] = item
  }
  return result as Partial<T>
}

// Paths present in `before` but missing from `after`. A config patch is a deep merge, so these
// have to be deleted explicitly for the stored entry to end up matching what was saved.
export function stalePaths(before: unknown, after: unknown, prefix: string[] = []): string[][] {
  if (!isPlainObject(before) || !isPlainObject(after)) return []
  return Object.entries(before).flatMap(([key, value]) => {
    const next = after[key]
    if (next === undefined) return [[...prefix, key]]
    return stalePaths(value, next, [...prefix, key])
  })
}
