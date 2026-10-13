// Free-tier usage for OpenCode Mod's "Session limits" tab.
//
// OpenCode's gateway counts free-model requests per public IP per UTC day on its own servers and
// exposes no remaining-quota API (the limit itself is a private server setting). So this reports
// what this machine used, from local history, and the public IP the limit is counted against.
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { and, gte, inArray } from "drizzle-orm"
import { Effect } from "effect"

const DAY = 86_400_000
// Enough days to estimate the daily limit from the last time it was hit.
export const HISTORY_DAYS = 7

export type FreeTierRequest = {
  time: number
  modelID: string
  tokens: number
  limited: boolean
  failed: boolean
}

// Stored message data is a union the type system cannot narrow by role, so assistant replies are
// recognised with an explicit guard.
type StoredReply = {
  role: "assistant"
  providerID: string
  modelID: string
  time: { created: number }
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  error?: unknown
}

function isReply(data: unknown): data is StoredReply {
  return typeof data === "object" && data !== null && "role" in data && data.role === "assistant"
}

// The gateway answers an exhausted free tier with FreeUsageLimitError ("Rate limit exceeded")
// and HTTP 429.
export function isLimitError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const status = "data" in error && error.data && typeof error.data === "object" && "statusCode" in error.data
  if (status && (error.data as { statusCode?: unknown }).statusCode === 429) return true
  return /FreeUsageLimitError|rate limit exceeded/i.test(JSON.stringify(error))
}

export const usage = Effect.fn("ModFreeTier.usage")(function* (now: number) {
  const { db } = yield* Database.Service
  const dayStart = now - (now % DAY)
  const since = dayStart - (HISTORY_DAYS - 1) * DAY
  // Messages are indexed by session and time, so narrow to recently active sessions first
  // instead of scanning every message ever stored.
  const sessions = yield* db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(gte(SessionTable.time_updated, since))
    .all()
    .pipe(Effect.orDie)

  const requests: FreeTierRequest[] = []
  const ids = sessions.map((session) => session.id)
  for (let i = 0; i < ids.length; i += 500) {
    const rows = yield* db
      .select({ data: MessageTable.data })
      .from(MessageTable)
      .where(and(inArray(MessageTable.session_id, ids.slice(i, i + 500)), gte(MessageTable.time_created, since)))
      .all()
      .pipe(Effect.orDie)
    for (const { data } of rows) {
      if (!isReply(data) || data.providerID !== "opencode") continue
      const tokens = data.tokens
      requests.push({
        time: data.time.created,
        modelID: data.modelID,
        tokens: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write,
        limited: isLimitError(data.error),
        failed: data.error !== undefined,
      })
    }
  }
  requests.sort((a, b) => a.time - b.time)
  return { now, dayStart, resetAt: dayStart + DAY, requests }
})

// The address OpenCode's gateway sees. api64 answers over IPv6 when the machine has it, which is
// what the gateway would see too (it limits IPv6 by /64 network).
export async function publicIp(): Promise<{ ip?: string; error?: string }> {
  try {
    const response = await fetch("https://api64.ipify.org?format=json", { signal: AbortSignal.timeout(5000) })
    const body: unknown = await response.json()
    if (body && typeof body === "object" && "ip" in body && typeof body.ip === "string") return { ip: body.ip }
    return { error: "Unexpected response" }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
