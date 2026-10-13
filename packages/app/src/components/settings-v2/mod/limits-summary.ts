// Turns the free-tier request history from /global/mod/free-tier into what the Session limits tab
// shows. OpenCode's gateway counts free-model requests per public IP per UTC day and does not
// publish the limit, so the limit is estimated from the last day it was actually hit.

export type FreeTierRequest = { time: number; modelID: string; tokens: number; limited: boolean; failed: boolean }

const DAY = 86_400_000
const HISTORY_DAYS = 7

// Free models cost nothing per token; `-free` ids and Big Pickle are free even when the catalog
// has no cost data for them.
export function isFreeModel(modelID: string, cost?: { input?: number; output?: number }) {
  if (cost && cost.input === 0 && cost.output === 0) return true
  return modelID.endsWith("-free") || modelID === "big-pickle"
}

export function summarize(input: {
  dayStart: number
  requests: readonly FreeTierRequest[]
  isFree: (modelID: string) => boolean
}) {
  const free = input.requests.filter((request) => input.isFree(request.modelID))
  const inDay = (start: number) => free.filter((request) => request.time >= start && request.time < start + DAY)

  const today = inDay(input.dayStart)
  const worked = today.filter((request) => !request.failed)
  const lastLimited = today.findLast((request) => request.limited)
  const lastWorked = worked.at(-1)
  // Still limited unless a request has worked since the last refusal.
  const limitedAt = lastLimited && (!lastWorked || lastWorked.time < lastLimited.time) ? lastLimited.time : undefined

  const models = [...Map.groupBy(worked, (request) => request.modelID)]
    .map(([modelID, list]) => ({
      modelID,
      requests: list.length,
      tokens: list.reduce((sum, request) => sum + request.tokens, 0),
    }))
    .sort((a, b) => b.requests - a.requests)

  const days = Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const start = input.dayStart - index * DAY
    const list = inDay(start)
    const firstLimit = list.find((request) => request.limited)
    return {
      day: new Date(start).toISOString().slice(0, 10),
      requests: list.filter((request) => !request.failed).length,
      // Requests that worked before the limit was first hit that day.
      beforeLimit: firstLimit
        ? list.filter((request) => !request.failed && request.time < firstLimit.time).length
        : undefined,
    }
  })

  const hit = days.find((day) => day.beforeLimit !== undefined)
  const estimate = hit?.beforeLimit !== undefined ? { requests: hit.beforeLimit, day: hit.day } : undefined

  return {
    today: {
      requests: worked.length,
      failed: today.length - worked.length,
      tokens: worked.reduce((sum, request) => sum + request.tokens, 0),
    },
    models,
    days,
    limitedAt,
    estimate,
    left: estimate ? Math.max(0, estimate.requests - worked.length) : undefined,
  }
}
