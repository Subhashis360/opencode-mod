import { describe, expect, test } from "bun:test"
import { defaultVisible, type Candidate } from "./models-default"

const now = Date.parse("2026-10-15")
const free = { input: 0, output: 0 }
const paid = { input: 1, output: 5 }

function model(id: string, release_date: string, family?: string, providerID = "opencode", cost = free): Candidate {
  return { id, family, release_date, provider: { id: providerID }, cost }
}

describe("default model visibility", () => {
  test("shows every OpenCode free model, with or without a family", () => {
    // Shapes the live catalog uses: no family, a family shared with an older model, and old releases.
    const models = [
      model("free-a", "2026-10-12"),
      model("free-b", "2026-09-23"),
      model("free-c", "2026-09-16"),
      model("free-d", "2026-09-22", "shared"),
      model("free-e", "2026-06-04", "shared"),
      model("free-f", "2025-10-17", "old"),
    ]
    expect(defaultVisible(models, now).size).toBe(6)
  })

  test("keeps only the newest recent model per family for paid models", () => {
    const keys = defaultVisible(
      [
        model("gpt-6", "2026-09-01", "gpt", "openai", paid),
        model("gpt-5.9", "2026-07-01", "gpt", "openai", paid),
        model("gpt-4", "2024-01-01", "gpt-old", "openai", paid),
      ],
      now,
    )
    expect([...keys]).toEqual(["openai:gpt-6"])
  })

  test("treats each paid model without a family as its own family", () => {
    const keys = defaultVisible(
      [model("a", "2026-09-01", undefined, "openai", paid), model("b", "2026-08-01", undefined, "openai", paid)],
      now,
    )
    expect(keys.size).toBe(2)
  })

  test("does not treat zero-cost models from other providers as free", () => {
    const keys = defaultVisible([model("local", "2020-01-01", "x", "ollama")], now)
    expect(keys.size).toBe(0)
  })
})
