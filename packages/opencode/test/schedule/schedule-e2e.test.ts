// Scheduled tasks against the real `opencode serve` process and a fake LLM.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { reply } from "../lib/llm-server"
import { cliIt } from "../lib/cli-process"

type Run = { status: string; sessionID?: string; error?: string; handled?: number; reason: string }
type Task = { id: string; enabled: boolean; nextRun: number | null }

const model = { providerID: "test", modelID: "test-model" }

const api = (url: string) => {
  const post = <T>(route: string, body: unknown) =>
    Effect.promise(async () => {
      const response = await fetch(`${url}/global/mod/schedule${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`)
      return (await response.json()) as T
    })
  const create = (input: Record<string, unknown>) =>
    post<{ success: boolean; task: Task; error?: string }>("/create", input).pipe(
      Effect.tap((result) => Effect.sync(() => expect(result.error).toBeUndefined())),
      Effect.map((result) => result.task),
    )
  const finished = (taskID: string) =>
    Effect.gen(function* () {
      for (let i = 0; i < 120; i++) {
        const [run] = yield* post<Run[]>("/runs", { taskID })
        if (run && run.status !== "running") return run
        yield* Effect.sleep("250 millis")
      }
      throw new Error("scheduled run did not finish")
    })
  const list = () =>
    Effect.promise(
      async () => (await (await fetch(`${url}/global/mod/schedule`)).json()) as { tasks: Task[]; active: string[] },
    )
  return { post, create, finished, list }
}

describe("scheduled tasks (subprocess)", () => {
  cliIt.live(
    "a one-off task fires on time, runs in its own session and then switches off",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("scheduled hello")
        const server = yield* opencode.serve()
        const client = api(server.url)
        const task = yield* client.create({
          name: "e2e once",
          prompt: "say the scheduled greeting",
          directory: home,
          model,
          trigger: { kind: "once", at: Date.now() + 2500 },
        })

        const run = yield* client.finished(task.id)
        expect(run.error).toBeUndefined()
        expect(run.status).toBe("success")
        expect(run.reason).toBe("schedule")
        expect(run.sessionID).toStartWith("ses")
        expect(JSON.stringify(yield* llm.inputs)).toContain("say the scheduled greeting")

        const after = (yield* client.list()).tasks.find((item) => item.id === task.id)
        expect(after?.enabled).toBe(false)
        expect(after?.nextRun).toBeNull()
      }),
    90_000,
  )

  cliIt.live(
    "run now starts a paused task and stop cancels it",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const server = yield* opencode.serve()
        const client = api(server.url)
        const task = yield* client.create({
          name: "e2e manual",
          prompt: "wait forever",
          directory: home,
          model,
          enabled: false,
          trigger: { kind: "daily", time: "03:00" },
        })

        expect(yield* client.post<boolean>("/run", { id: task.id })).toBe(true)
        yield* llm.wait(1)
        expect((yield* client.list()).active).toContain(task.id)
        expect(yield* client.post<boolean>("/cancel", { id: task.id })).toBe(true)

        const run = yield* client.finished(task.id)
        expect(run.reason).toBe("manual")
        expect(run.status).toBe("cancelled")
      }),
    90_000,
  )

  cliIt.live(
    "skip mode rejects approval prompts so an unattended run never stalls",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const outside = path.join(os.tmpdir(), `oc-schedule-outside-${process.pid}.txt`)
        yield* Effect.promise(() => Bun.write(outside, "outside the project"))
        yield* llm.push(reply().tool("read", { filePath: outside }))
        yield* llm.text("finished without the file")
        const server = yield* opencode.serve()
        const client = api(server.url)
        const task = yield* client.create({
          name: "e2e deny",
          prompt: "read the outside file",
          directory: home,
          model,
          permission: "deny",
          enabled: false,
          trigger: { kind: "daily", time: "03:00" },
        })

        yield* client.post("/run", { id: task.id })
        const run = yield* client.finished(task.id)
        expect(run.error).toBeUndefined()
        expect(run.status).toBe("success")
        expect(run.handled).toBe(1)
        expect(JSON.stringify(yield* llm.inputs)).toContain("approvals are turned off")
      }),
    90_000,
  )
})
