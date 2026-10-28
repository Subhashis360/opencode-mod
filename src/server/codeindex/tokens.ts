export * as CodeTokens from "./tokens.js"

// Code-aware words for the full-text index: identifiers are kept whole and split into their parts, so a search for
// "user profile" finds fetchUserProfile, user_profile and UserProfileCard alike.

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "be", "it", "this", "that", "how",
  "what", "where", "which", "who", "does", "do", "find", "code", "file", "files", "function", "functions", "show", "me",
  "all", "any", "from", "by", "at", "as", "into", "when", "i", "we", "you", "can", "should", "there", "my", "our",
])

// Words people use for the same idea in code, so a plain-language query also matches the names code uses.
const SYNONYMS: readonly (readonly string[])[] = [
  ["auth", "authenticate", "authentication", "login", "signin", "session", "token", "credential", "oauth"],
  ["delete", "remove", "destroy", "drop", "erase", "unlink"],
  ["create", "add", "new", "insert", "make", "build"],
  ["update", "edit", "modify", "change", "patch", "set"],
  ["get", "fetch", "load", "read", "retrieve", "request", "query"],
  ["save", "write", "store", "persist", "put"],
  ["config", "configuration", "settings", "options", "preferences", "env"],
  ["error", "exception", "fail", "failure", "throw", "catch", "panic"],
  ["test", "spec", "mock", "fixture", "assert", "expect"],
  ["user", "account", "member", "profile"],
  ["http", "api", "endpoint", "route", "handler", "controller", "server"],
  ["db", "database", "sql", "query", "repository", "model", "schema", "migration"],
  ["parse", "decode", "deserialize", "unmarshal"],
  ["serialize", "encode", "marshal", "stringify"],
  ["start", "init", "initialize", "setup", "boot", "launch"],
  ["stop", "shutdown", "close", "dispose", "cleanup", "teardown"],
  ["log", "logger", "logging", "trace", "debug"],
  ["cache", "memo", "memoize"],
  ["validate", "validation", "check", "verify", "sanitize"],
  ["permission", "authorize", "authorization", "acl", "role", "access"],
  ["upload", "download", "file", "stream"],
  ["schedule", "cron", "timer", "interval", "job", "task", "queue", "worker"],
  ["render", "view", "component", "ui", "page", "template"],
  ["send", "emit", "publish", "notify", "dispatch"],
  ["listen", "subscribe", "watch", "observe", "on"],
  ["encrypt", "crypto", "hash", "sign", "cipher", "decrypt"],
]

const SYNONYM_OF = new Map<string, readonly string[]>()
for (const group of SYNONYMS) for (const word of group) SYNONYM_OF.set(word, group)

const IDENTIFIER = /[A-Za-z_$][\w$]*/g

/** An identifier's parts: fetchUserProfile → fetch, user, profile; HTTPServer2 → http, server. */
export function parts(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter((part) => part.length > 1)
    .map((part) => part.toLowerCase())
}

/** The words indexed for some code: each identifier whole, and its parts. Repeats are kept: they weigh the ranking. */
export function index(text: string): string {
  const words: string[] = []
  for (const match of text.matchAll(IDENTIFIER)) {
    const word = match[0]
    if (word.length < 2 || word.length > 64) continue
    const split = parts(word)
    const whole = word.replace(/\$/g, "").toLowerCase()
    words.push(whole)
    if (split.length > 1) words.push(...split)
  }
  return words.join(" ")
}

/** Path words: src/server/userProfile.ts → src server userprofile user profile ts. */
export function path(file: string) {
  return index(file.replace(/[\\/._-]+/g, " "))
}

/**
 * The FTS5 query for a search: each word and its parts, any of which may match. With `synonyms`, only the words code
 * uses for the same ideas, which rank below the user's own words.
 */
export function query(text: string, synonyms = false): string | undefined {
  const own = new Set<string>()
  const related = new Set<string>()
  for (const match of text.matchAll(IDENTIFIER)) {
    const word = match[0].replace(/\$/g, "").toLowerCase()
    if (word.length < 2) continue
    if (!STOP.has(word)) own.add(word)
    for (const part of parts(match[0])) {
      if (STOP.has(part)) continue
      own.add(part)
      for (const synonym of SYNONYM_OF.get(part) ?? []) related.add(synonym)
    }
  }
  const terms = synonyms ? [...related].filter((term) => !own.has(term)) : [...own]
  if (!terms.length) return undefined
  return terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" OR ")
}

/** The query's own words (without synonyms), for highlighting and scoring exact matches. */
export function words(text: string) {
  const set = new Set<string>()
  for (const match of text.matchAll(IDENTIFIER)) {
    const word = match[0].toLowerCase()
    if (!STOP.has(word) && word.length > 1) set.add(word)
    for (const part of parts(match[0])) if (!STOP.has(part)) set.add(part)
  }
  return set
}
