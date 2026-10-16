import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { AccountPool } from "../../src/auth/account-pool"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Auth.node, AccountPool.node])))

describe("AccountPool", () => {
  it.instance("adds accounts through the normal login and switches auth.json between them", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const pool = yield* AccountPool.Service

      yield* auth.set("groq", { type: "api", key: "k1" })
      yield* pool.beginAdd("groq")
      // The Providers login for the second account goes through Auth.set as usual.
      yield* auth.set("groq", { type: "api", key: "k2" })

      const accounts = (yield* pool.list()).groq
      expect(accounts).toHaveLength(2)
      expect(yield* auth.get("groq")).toMatchObject({ key: "k2" })

      // The active account hits a limit: auth.json now holds the other one.
      expect(yield* pool.rotate("groq", Date.now() + 60_000)).toBe("Account 1")
      expect(yield* auth.get("groq")).toMatchObject({ key: "k1" })
      const limited = (yield* pool.list()).groq.find((item) => item.label === "Account 2")
      expect(limited?.limitedUntil).toBeGreaterThan(Date.now())

      // Both limited: nothing to switch to, auth.json is left as it is.
      expect(yield* pool.rotate("groq", Date.now() + 60_000)).toBeUndefined()
      expect(yield* auth.get("groq")).toMatchObject({ key: "k1" })

      // Choosing an account by hand makes it usable again.
      const second = accounts.find((item) => item.label === "Account 2")!
      expect(yield* pool.select("groq", second.id)).toBe(true)
      expect(yield* auth.get("groq")).toMatchObject({ key: "k2" })
    }),
  )

  it.instance("removing the last account disconnects the provider", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const pool = yield* AccountPool.Service

      yield* auth.set("groq", { type: "api", key: "k1" })
      yield* pool.beginAdd("groq")
      yield* auth.set("groq", { type: "api", key: "k2" })
      const [first, second] = (yield* pool.list()).groq

      expect(yield* pool.remove("groq", second.id)).toBe(true)
      expect(yield* auth.get("groq")).toMatchObject({ key: "k1" })
      expect(yield* pool.remove("groq", first.id)).toBe(true)
      expect(yield* auth.get("groq")).toBeUndefined()
      expect((yield* pool.list()).groq).toBeUndefined()
    }),
  )

  it.instance("disconnecting a provider forgets its accounts", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const pool = yield* AccountPool.Service

      yield* auth.set("groq", { type: "api", key: "k1" })
      yield* pool.beginAdd("groq")
      yield* auth.set("groq", { type: "api", key: "k2" })
      yield* auth.remove("groq")
      expect((yield* pool.list()).groq).toBeUndefined()
    }),
  )
})
