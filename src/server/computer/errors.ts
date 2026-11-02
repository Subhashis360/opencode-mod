export * as ComputerErrors from "./errors.js"

// Every failure carries a code and whether trying again can help, so the model knows from the error alone whether
// to repeat the step, look first, or change its approach instead of retrying the same thing.

/** safe: repeat as is. look_first: the screen changed, look again and act on the new map. no: retrying cannot help. */
export type Retry = "safe" | "look_first" | "no"

export class ComputerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retry: Retry = "look_first",
  ) {
    super(message)
  }
}

export const fail = (code: string, message: string, retry: Retry = "look_first") =>
  new ComputerError(code, message, retry)

const HINT: Record<Retry, string> = {
  safe: "safe to retry",
  look_first: "look again before retrying",
  no: "do not retry, change the approach",
}

// Actions that only read, so repeating one after a timeout cannot do anything twice.
const READS = new Set([
  "screenshot",
  "zoom",
  "read_window",
  "inspect",
  "list_displays",
  "list_windows",
  "cursor_position",
  "wait_for",
  "watch",
  "read_clipboard",
])

/** Any error as a ComputerError. The helper marks its own with a `CODE: ` prefix. */
export function classify(error: unknown, action: string): ComputerError {
  if (error instanceof ComputerError) return error
  const text = error instanceof Error ? error.message : String(error)
  const coded = /^([A-Z][A-Z_]{2,}): ([\s\S]*)$/.exec(text)
  if (coded) {
    const code = coded[1]!
    const retry: Retry =
      code === "TIMEOUT"
        ? READS.has(action)
          ? "safe"
          : "look_first"
        : code === "STALE_REF" || code === "NOT_FOUND" || code === "DISABLED"
          ? "look_first"
          : "no"
    return new ComputerError(code, coded[2]!, retry)
  }
  if (/timed out|took too long/.test(text))
    return new ComputerError("TIMEOUT", text, READS.has(action) ? "safe" : "look_first")
  if (/blocked the input/.test(text)) return new ComputerError("BLOCKED", text, "no")
  if (/helper (stopped|did not start)/.test(text)) return new ComputerError("HELPER_DOWN", text, "safe")
  return new ComputerError("FAILED", text, READS.has(action) ? "safe" : "look_first")
}

export function format(error: ComputerError) {
  return `${error.code} (${HINT[error.retry]}): ${error.message}`
}
