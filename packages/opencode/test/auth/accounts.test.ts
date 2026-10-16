import { describe, expect, test } from "bun:test"
import * as Accounts from "../../src/auth/accounts"
import type { Auth } from "../../src/auth"

let n = 0
const id = () => `acc_${++n}`
const key = (value: string): Auth.Info => ({ type: "api", key: value }) as Auth.Info
const oauth = (accountId: string, refresh: string): Auth.Info =>
  ({ type: "oauth", accountId, refresh, access: "a", expires: 0 }) as Auth.Info

describe("account pool", () => {
  test("a provider without a pool is left alone", () => {
    const pool: Accounts.Pool = {}
    expect(Accounts.onSet(pool, "groq", key("k1"), 0, id)).toBe(pool)
  })

  test("adding an account keeps the current one and makes the new one active", () => {
    let pool = Accounts.beginAdd({}, "groq", key("k1"), 0, id)
    pool = Accounts.onSet(pool, "groq", key("k2"), 1, id)
    const view = Accounts.view(pool, 1).groq
    expect(view.map((item) => item.label)).toEqual(["Account 1", "Account 2"])
    expect(view.find((item) => item.active)?.label).toBe("Account 2")
    expect(pool.groq.pendingAdd).toBeUndefined()
  })

  test("a token refresh updates the active account instead of adding one", () => {
    let pool = Accounts.beginAdd({}, "openai", oauth("u1", "r1"), 0, id)
    pool = Accounts.onSet(pool, "openai", oauth("u2", "r2"), 1, id)
    pool = Accounts.onSet(pool, "openai", oauth("u2", "r3"), 2, id)
    expect(pool.openai.accounts).toHaveLength(2)
    const active = pool.openai.accounts.find((item) => item.id === pool.openai.active)!
    expect(active.info).toMatchObject({ accountId: "u2", refresh: "r3" })
  })

  test("logging in to an account that is already there does not duplicate it", () => {
    let pool = Accounts.beginAdd({}, "groq", key("k1"), 0, id)
    pool = Accounts.onSet(pool, "groq", key("k1"), 1, id)
    expect(pool.groq.accounts).toHaveLength(1)
  })

  test("an add that was never finished expires", () => {
    let pool = Accounts.beginAdd({}, "groq", key("k1"), 0, id)
    pool = Accounts.onSet(pool, "groq", key("k2"), Accounts.PENDING_ADD_MS + 1, id)
    expect(pool.groq.accounts).toHaveLength(1)
    expect(pool.groq.accounts[0].info).toMatchObject({ key: "k2" })
  })

  test("rotate skips limited accounts and wraps around", () => {
    let pool = Accounts.beginAdd({}, "groq", key("k1"), 0, id)
    pool = Accounts.onSet(pool, "groq", key("k2"), 0, id)
    pool = Accounts.beginAdd(pool, "groq", undefined, 0, id)
    pool = Accounts.onSet(pool, "groq", key("k3"), 0, id)
    // k3 active; it hits a limit -> wraps to k1
    const first = Accounts.rotate(pool, "groq", 10, 100)!
    expect(first.to?.info).toMatchObject({ key: "k1" })
    // k1 hits a limit too -> k2
    const second = Accounts.rotate(first.pool, "groq", 20, 100)!
    expect(second.to?.info).toMatchObject({ key: "k2" })
    // k2 as well -> nothing left until the limits pass
    const third = Accounts.rotate(second.pool, "groq", 30, 100)!
    expect(third.to).toBeUndefined()
    expect(Accounts.view(third.pool, 30).groq.every((item) => item.limitedUntil === 100)).toBe(true)
    // after the limit passes the next account is usable again
    expect(Accounts.rotate(third.pool, "groq", 101, 200)?.to).toBeDefined()
  })

  test("rotate needs at least two accounts", () => {
    const pool = Accounts.beginAdd({}, "groq", key("k1"), 0, id)
    expect(Accounts.rotate(pool, "groq", 0, 1)).toBeUndefined()
  })

  test("select and drop keep one active account", () => {
    let pool = Accounts.beginAdd({}, "groq", key("k1"), 0, id)
    pool = Accounts.onSet(pool, "groq", key("k2"), 0, id)
    const [a1, a2] = pool.groq.accounts
    const selected = Accounts.select(pool, "groq", a1.id)!
    expect(selected.info).toMatchObject({ key: "k1" })
    const dropped = Accounts.drop(selected.pool, "groq", a1.id)!
    expect(dropped.pool.groq.active).toBe(a2.id)
    expect(dropped.info).toMatchObject({ key: "k2" })
    const last = Accounts.drop(dropped.pool, "groq", a2.id)!
    expect(last.info).toBeUndefined()
    expect(last.pool.groq).toBeUndefined()
  })

  test("the view never exposes secrets", () => {
    const pool = Accounts.beginAdd({}, "groq", key("secret-key"), 0, id)
    expect(JSON.stringify(Accounts.view(pool, 0))).not.toContain("secret-key")
  })
})

describe("account pool file", () => {
  test("drops malformed entries instead of failing", () => {
    const pool = Accounts.parsePool({
      groq: {
        active: "a1",
        accounts: [
          { id: "a1", label: "Account 1", added: 1, info: { type: "api", key: "k" } },
          { id: "a2", label: "Broken", info: null },
          "junk",
        ],
      },
      openai: { active: 5, accounts: [] },
      broken: "x",
    })
    expect(Object.keys(pool)).toEqual(["groq"])
    expect(pool.groq.accounts.map((item) => item.id)).toEqual(["a1"])
    expect(Accounts.parsePool(null)).toEqual({})
    expect(Accounts.parsePool([1, 2])).toEqual({})
  })
})
