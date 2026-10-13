import { describe, expect, mock, test } from "bun:test"

mock.module("./store", () => ({ getStore: () => ({ get: () => undefined }) }))
const { parseModFlags } = await import("./mod-flags")

describe("parseModFlags", () => {
  test("keeps engine feature switches", () => {
    const raw = JSON.stringify({
      OPENCODE_EXPERIMENTAL_LSP_TOOL: "true",
      OPENCODE_ENABLE_EXA: "1",
      OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "300000",
    })
    expect(parseModFlags(raw)).toEqual({
      OPENCODE_EXPERIMENTAL_LSP_TOOL: "true",
      OPENCODE_ENABLE_EXA: "1",
      OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "300000",
    })
  })

  test("drops anything that is not an engine switch with a plain value", () => {
    const raw = JSON.stringify({
      PATH: "C:\\evil",
      NODE_OPTIONS: "--require x",
      OPENCODE_SERVER_PASSWORD: "x",
      OPENCODE_ENABLE_EXA: "true; rm -rf /",
      OPENCODE_EXPERIMENTAL_CODE_MODE: 1,
    })
    expect(parseModFlags(raw)).toEqual({})
  })

  test("ignores missing or malformed data", () => {
    expect(parseModFlags(undefined)).toEqual({})
    expect(parseModFlags("not json")).toEqual({})
    expect(parseModFlags("[1,2]")).toEqual({})
  })
})
