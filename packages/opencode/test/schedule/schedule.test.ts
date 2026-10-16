import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "fs/promises"
import os from "os"
import { Schedule } from "../../src/schedule/schedule"
import { ScheduleStore } from "../../src/schedule/store"

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe("schedule.next", () => {
  test("daily runs later today, else tomorrow", () => {
    const morning = local(2026, 10, 16, 8, 0)
    expect(Schedule.next({ kind: "daily", time: "09:30" }, morning)).toBe(local(2026, 10, 16, 9, 30))
    expect(Schedule.next({ kind: "daily", time: "07:00" }, morning)).toBe(local(2026, 10, 17, 7, 0))
    expect(Schedule.next({ kind: "daily", time: "08:00" }, morning)).toBe(local(2026, 10, 17, 8, 0))
  })

  test("weekly picks the next listed weekday", () => {
    // 2026-10-16 is a Friday.
    const friday = local(2026, 10, 16, 12, 0)
    expect(Schedule.next({ kind: "weekly", time: "09:00", days: [1, 3] }, friday)).toBe(local(2026, 10, 19, 9, 0))
    expect(Schedule.next({ kind: "weekly", time: "18:00", days: [5] }, friday)).toBe(local(2026, 10, 16, 18, 0))
  })

  test("monthly clamps day 31 to the end of shorter months", () => {
    expect(Schedule.next({ kind: "monthly", time: "10:00", day: 31 }, local(2026, 11, 1))).toBe(local(2026, 11, 30, 10))
    expect(Schedule.next({ kind: "monthly", time: "10:00", day: 31 }, local(2027, 2, 1))).toBe(local(2027, 2, 28, 10))
    expect(Schedule.next({ kind: "monthly", time: "10:00", day: 5 }, local(2026, 10, 16))).toBe(local(2026, 11, 5, 10))
  })

  test("interval and once", () => {
    const now = local(2026, 10, 16, 8, 0)
    expect(Schedule.next({ kind: "interval", minutes: 30 }, now)).toBe(now + 30 * 60_000)
    expect(Schedule.next({ kind: "once", at: now + 1000 }, now)).toBe(now + 1000)
    expect(Schedule.next({ kind: "once", at: now - 1000 }, now)).toBeUndefined()
  })

  test("cron supports steps, ranges, lists and names", () => {
    const now = local(2026, 10, 16, 8, 7)
    expect(Schedule.next({ kind: "cron", expression: "*/15 * * * *" }, now)).toBe(local(2026, 10, 16, 8, 15))
    expect(Schedule.next({ kind: "cron", expression: "0 9-17 * * mon-fri" }, now)).toBe(local(2026, 10, 16, 9, 0))
    expect(Schedule.next({ kind: "cron", expression: "30 6 1,15 * *" }, now)).toBe(local(2026, 11, 1, 6, 30))
    expect(Schedule.next({ kind: "cron", expression: "0 0 * * 7" }, now)).toBe(local(2026, 10, 18, 0, 0))
  })

  test("validate rejects schedules that cannot run", () => {
    expect(() => Schedule.validate({ kind: "once", at: Date.now() - 1 })).toThrow("past")
    expect(() => Schedule.validate({ kind: "weekly", time: "09:00", days: [] })).toThrow("weekday")
    expect(() => Schedule.validate({ kind: "interval", minutes: 0 })).toThrow("at least 1")
    expect(() => Schedule.validate({ kind: "cron", expression: "61 * * * *" })).toThrow("Invalid cron")
    expect(() => Schedule.validate({ kind: "cron", expression: "* * *" })).toThrow("5 fields")
  })
})

describe("schedule store", () => {
  afterEach(() => rm(ScheduleStore.file(), { force: true }))

  test("creates, edits, pauses, queues and deletes tasks", async () => {
    const task = await ScheduleStore.create({
      name: "  Morning report ",
      prompt: "Summarise yesterday's commits",
      directory: os.tmpdir(),
      trigger: { kind: "daily", time: "09:00" },
    })
    expect(task.name).toBe("Morning report")
    expect(task.permission).toBe("ask")
    expect(task.enabled).toBe(true)
    expect(task.nextRun).toBeGreaterThan(Date.now())

    const paused = await ScheduleStore.update(task.id, { enabled: false, trigger: { kind: "interval", minutes: 5 } })
    expect(paused.enabled).toBe(false)
    expect(paused.nextRun).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000)

    await ScheduleStore.requestRun(task.id)
    expect(await ScheduleStore.takeRequests()).toEqual([task.id])
    expect(await ScheduleStore.takeRequests()).toEqual([])

    await ScheduleStore.saveRun({
      id: "r1",
      taskID: task.id,
      reason: "manual",
      started: 1,
      status: "success",
      directory: os.tmpdir(),
    })
    expect((await ScheduleStore.get(task.id))?.lastRun?.status).toBe("success")

    expect(await ScheduleStore.remove(task.id)).toBe(true)
    expect(await ScheduleStore.list()).toEqual([])
    expect(await ScheduleStore.runs()).toEqual([])
  })

  test("refuses bad input with a readable reason", async () => {
    const base = { name: "x", prompt: "y", directory: os.tmpdir(), trigger: { kind: "daily" as const, time: "09:00" } }
    await expect(ScheduleStore.create({ ...base, directory: "Z:/does/not/exist" })).rejects.toThrow("Folder not found")
    await expect(ScheduleStore.create({ ...base, name: " " })).rejects.toThrow("name")
    await expect(ScheduleStore.create({ ...base, timeoutMinutes: 0 })).rejects.toThrow("Timeout")
    await expect(ScheduleStore.update("missing", { name: "z" })).rejects.toThrow("not found")
  })

  test("keeps only the newest runs per task and closes orphaned runs", async () => {
    const task = await ScheduleStore.create({
      name: "t",
      prompt: "p",
      directory: os.tmpdir(),
      trigger: { kind: "interval", minutes: 1 },
    })
    for (let i = 0; i < 35; i++)
      await ScheduleStore.saveRun({
        id: `r${i}`,
        taskID: task.id,
        reason: "schedule",
        started: i,
        status: i === 34 ? "running" : "success",
        directory: os.tmpdir(),
      })
    expect(await ScheduleStore.runs(task.id, 100)).toHaveLength(30)
    await ScheduleStore.closeOrphans()
    const latest = (await ScheduleStore.runs(task.id, 1))[0]
    expect(latest.status).toBe("cancelled")
  })
})
