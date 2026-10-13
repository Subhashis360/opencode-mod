import { describe, expect, test } from "bun:test"
import { isLimitError } from "../../src/mod/free-tier"
import { BUILT_IN_PROMPTS } from "../../src/mod/prompts"

describe("isLimitError", () => {
  test("recognises the gateway's free-tier limit response", () => {
    expect(isLimitError({ name: "APIError", data: { statusCode: 429, message: "Too Many Requests" } })).toBe(true)
    expect(
      isLimitError({
        name: "APIError",
        data: { responseBody: '{"type":"error","error":{"type":"FreeUsageLimitError","message":"x"}}' },
      }),
    ).toBe(true)
    expect(isLimitError({ name: "APIError", data: { message: "Rate limit exceeded. Please try again later." } })).toBe(
      true,
    )
  })

  test("ignores other failures", () => {
    expect(isLimitError(undefined)).toBe(false)
    expect(isLimitError({ name: "APIError", data: { statusCode: 400, message: "credit insufficient balance" } })).toBe(
      false,
    )
    expect(isLimitError({ name: "AbortError", data: {} })).toBe(false)
  })
})

describe("BUILT_IN_PROMPTS", () => {
  test("bundles every model system prompt with its content", () => {
    expect(BUILT_IN_PROMPTS.map((prompt) => prompt.id)).toEqual([
      "anthropic",
      "gpt",
      "codex",
      "beast",
      "gemini",
      "kimi",
      "trinity",
      "meta",
      "default",
    ])
    for (const prompt of BUILT_IN_PROMPTS) expect(prompt.content.length).toBeGreaterThan(100)
  })
})
