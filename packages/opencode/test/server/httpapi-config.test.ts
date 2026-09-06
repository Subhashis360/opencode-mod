import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )

  it.live(
    "replaces provider models and headers instead of merging them into the previous write",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      const patch = (provider: unknown) =>
        Effect.gen(function* () {
          const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))
          const response = yield* Effect.promise(() =>
            Promise.resolve(
              app().request("/config", {
                method: "PATCH",
                headers: {
                  "content-type": "application/json",
                  "x-opencode-directory": tmp.path,
                },
                body: JSON.stringify({ formatter: false, lsp: false, provider }),
              }),
            ),
          )
          expect(response.status).toBe(200)
          yield* Fiber.join(disposed)
        })

      yield* patch({
        custom: {
          npm: "@ai-sdk/openai-compatible",
          name: "Custom",
          options: { baseURL: "https://api.example.com", headers: { "X-Old": "old" } },
          models: { "model-a": { name: "Model A" }, "model-b": { name: "Model B" } },
        },
      })

      yield* patch({
        custom: {
          npm: "@ai-sdk/openai-compatible",
          name: "Custom",
          options: { baseURL: "https://api.example.com/v2", headers: { "X-New": "new" } },
          models: { "model-a": { name: "Model A" } },
        },
      })

      const written = yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())
      expect(Object.keys(written.provider.custom.models)).toEqual(["model-a"])
      expect(written.provider.custom.options.headers).toEqual({ "X-New": "new" })
      expect(written.provider.custom.options.baseURL).toBe("https://api.example.com/v2")
    }),
  )
})
