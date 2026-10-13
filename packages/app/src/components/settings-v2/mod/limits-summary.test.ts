import { describe, expect, test } from "bun:test"
import { isFreeModel, summarize, type FreeTierRequest } from "./limits-summary"

const DAY = 86_400_000
const dayStart = Date.UTC(2026, 9, 13)
const at = (offsetDays: number, minutes: number) => dayStart + offsetDays * DAY + minutes * 60_000
const ok = (time: number, modelID = "big-pickle", tokens = 100): FreeTierRequest => ({
  time,
  modelID,
  tokens,
  limited: false,
  failed: false,
})
const refused = (time: number, modelID = "big-pickle"): FreeTierRequest => ({
  time,
  modelID,
  tokens: 0,
  limited: true,
  failed: true,
})

describe("isFreeModel", () => {
  test("uses zero cost or a free model id", () => {
    expect(isFreeModel("some-model", { input: 0, output: 0 })).toBe(true)
    expect(isFreeModel("mimo-v2.6-flash-free")).toBe(true)
    expect(isFreeModel("big-pickle")).toBe(true)
    expect(isFreeModel("claude-sonnet", { input: 3, output: 15 })).toBe(false)
  })
})

describe("summarize", () => {
  test("counts today's free requests and tokens per model", () => {
    const summary = summarize({
      dayStart,
      isFree: (id) => isFreeModel(id),
      requests: [ok(at(-1, 10)), ok(at(0, 5)), ok(at(0, 6), "mimo-v2.6-flash-free", 50), ok(at(0, 7), "paid-model")],
    })
    expect(summary.today).toEqual({ requests: 2, failed: 0, tokens: 150 })
    expect(summary.models.map((model) => model.modelID)).toEqual(["big-pickle", "mimo-v2.6-flash-free"])
    expect(summary.days[0]).toMatchObject({ day: "2026-10-13", requests: 2 })
    expect(summary.days[1]).toMatchObject({ day: "2026-10-12", requests: 1 })
    expect(summary.limitedAt).toBeUndefined()
    expect(summary.estimate).toBeUndefined()
  })

  test("estimates the limit from the last day it was hit and what is left today", () => {
    const summary = summarize({
      dayStart,
      isFree: (id) => isFreeModel(id),
      requests: [ok(at(-2, 1)), ok(at(-2, 2)), ok(at(-2, 3)), refused(at(-2, 4)), ok(at(0, 1))],
    })
    expect(summary.estimate).toEqual({ requests: 3, day: "2026-10-11" })
    expect(summary.left).toBe(2)
  })

  test("reports a limit hit today until a request works again", () => {
    const limited = summarize({ dayStart, isFree: () => true, requests: [ok(at(0, 1)), refused(at(0, 2))] })
    expect(limited.limitedAt).toBe(at(0, 2))
    expect(limited.left).toBe(0)

    const recovered = summarize({
      dayStart,
      isFree: () => true,
      requests: [ok(at(0, 1)), refused(at(0, 2)), ok(at(0, 3))],
    })
    expect(recovered.limitedAt).toBeUndefined()
  })
})
