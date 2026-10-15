import { beforeAll, describe, expect, mock, test } from "bun:test"

let calls = 0
let finish: () => void = () => {}

let useModelCatalogRefresh: typeof import("./use-model-catalog-refresh").useModelCatalogRefresh

beforeAll(async () => {
  mock.module("@/context/server-sdk", () => ({
    useServerSDK: () => () => ({
      client: {
        global: {
          mod: {
            modelsRefresh: () => {
              calls++
              return new Promise<void>((resolve) => {
                finish = resolve
              })
            },
          },
        },
      },
    }),
  }))
  useModelCatalogRefresh = (await import("./use-model-catalog-refresh")).useModelCatalogRefresh
})

describe("model catalog refresh", () => {
  test("downloads once per open, not again while a download is running", async () => {
    const refresh = useModelCatalogRefresh()
    refresh()
    refresh()
    expect(calls).toBe(1)

    finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    refresh()
    expect(calls).toBe(2)
    finish()
  })
})
