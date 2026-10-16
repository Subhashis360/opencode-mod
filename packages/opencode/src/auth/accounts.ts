// OpenCode Mod: several accounts per provider.
//
// auth.json keeps exactly one credential per provider, and everything that sends requests reads it.
// The pool keeps every account the user added for a provider; auth.json always holds the active one.
// A provider only gets a pool once the user adds a second account, so single-account providers
// behave exactly as before.
//
// These functions are pure: they take a pool and return the next pool plus whatever credential
// should now be written to auth.json. File access lives in the Auth service.
import { randomUUID } from "node:crypto"
import type { Info } from "./index"

export const newID = () => `acc_${randomUUID()}`

export type Account = {
  id: string
  label: string
  info: Info
  added: number
  /** Set when the account hit a usage or rate limit; it is skipped until then. */
  limitedUntil?: number
}

export type ProviderPool = {
  active: string
  accounts: Account[]
  /** When the user started adding an account; the next login for the provider becomes a new account. */
  pendingAdd?: number
}

export type Pool = Record<string, ProviderPool>

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function isAccount(value: unknown): value is Account {
  if (!isObject(value) || !isObject(value.info)) return false
  const kind = value.info.type
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.added === "number" &&
    (value.limitedUntil === undefined || typeof value.limitedUntil === "number") &&
    (kind === "api" || kind === "oauth" || kind === "wellknown")
  )
}

/** Reads the pool file's contents, dropping anything malformed (e.g. after a hand edit). */
export function parsePool(value: unknown): Pool {
  if (!isObject(value)) return {}
  const pool: Pool = {}
  for (const [providerID, entry] of Object.entries(value)) {
    if (!isObject(entry) || typeof entry.active !== "string" || !Array.isArray(entry.accounts)) continue
    pool[providerID] = {
      active: entry.active,
      accounts: entry.accounts.filter(isAccount),
      ...(typeof entry.pendingAdd === "number" ? { pendingAdd: entry.pendingAdd } : {}),
    }
  }
  return pool
}

/** An "add account" login must finish within this window, like an OAuth attempt. */
export const PENDING_ADD_MS = 15 * 60 * 1000
/** How long a limited account is skipped when the provider gives no reset time. */
export const DEFAULT_LIMIT_MS = 60 * 60 * 1000

// Two credentials are the same account when they carry the same key, or for OAuth the same account
// id. Refresh tokens rotate on refresh, so they only identify an account when there is no id.
function identity(info: Info) {
  if (info.type === "api") return `api:${info.key}`
  if (info.type === "wellknown") return `wellknown:${info.key}:${info.token}`
  return info.accountId ? `oauth:${info.accountId}` : `oauth-refresh:${info.refresh}`
}

function nextLabel(accounts: Account[]) {
  const used = new Set(accounts.map((account) => account.label))
  for (let n = accounts.length + 1; ; n++) if (!used.has(`Account ${n}`)) return `Account ${n}`
}

function makeAccount(info: Info, accounts: Account[], now: number, id: string): Account {
  return { id, label: nextLabel(accounts), info, added: now }
}

/**
 * The user asked to add another account for a provider. Seeds the pool with the provider's current
 * credential (as account 1) and marks the next login for this provider as a new account.
 */
export function beginAdd(pool: Pool, providerID: string, current: Info | undefined, now: number, newID: () => string) {
  const existing = pool[providerID]
  if (existing) return { ...pool, [providerID]: { ...existing, pendingAdd: now } }
  if (!current) return { ...pool, [providerID]: { active: "", accounts: [], pendingAdd: now } }
  const first = makeAccount(current, [], now, newID())
  return { ...pool, [providerID]: { active: first.id, accounts: [first], pendingAdd: now } }
}

/** auth.json received a credential for a provider: a new account, a re-login or a token refresh. */
export function onSet(pool: Pool, providerID: string, info: Info, now: number, newID: () => string): Pool {
  const entry = pool[providerID]
  if (!entry) return pool
  const adding = entry.pendingAdd !== undefined && now - entry.pendingAdd < PENDING_ADD_MS
  const same = entry.accounts.find((account) => identity(account.info) === identity(info))
  if (same) {
    // The same account again (logged in twice, or refreshed): keep one copy, now usable.
    const accounts = entry.accounts.map((account) =>
      account.id === same.id ? { ...account, info, limitedUntil: undefined } : account,
    )
    return { ...pool, [providerID]: { active: same.id, accounts } }
  }
  if (adding || !entry.accounts.some((account) => account.id === entry.active)) {
    const account = makeAccount(info, entry.accounts, now, newID())
    return { ...pool, [providerID]: { active: account.id, accounts: [...entry.accounts, account] } }
  }
  // A token refresh or a plain re-login replaces the active account's credential.
  const accounts = entry.accounts.map((account) => (account.id === entry.active ? { ...account, info } : account))
  return { ...pool, [providerID]: { ...entry, accounts } }
}

/** The provider was disconnected: forget all of its accounts. */
export function onRemove(pool: Pool, providerID: string): Pool {
  if (!pool[providerID]) return pool
  const next = { ...pool }
  delete next[providerID]
  return next
}

/** Make one account active. Returns the credential to write to auth.json. */
export function select(pool: Pool, providerID: string, accountID: string) {
  const entry = pool[providerID]
  const account = entry?.accounts.find((item) => item.id === accountID)
  if (!entry || !account) return undefined
  const accounts = entry.accounts.map((item) => (item.id === accountID ? { ...item, limitedUntil: undefined } : item))
  return { pool: { ...pool, [providerID]: { active: accountID, accounts } }, info: account.info }
}

/**
 * Remove one account. Returns the credential that should now be in auth.json, or undefined when the
 * provider has no accounts left and should be disconnected.
 */
export function drop(pool: Pool, providerID: string, accountID: string) {
  const entry = pool[providerID]
  if (!entry || !entry.accounts.some((item) => item.id === accountID)) return undefined
  const accounts = entry.accounts.filter((item) => item.id !== accountID)
  if (accounts.length === 0) return { pool: onRemove(pool, providerID), info: undefined }
  const active = entry.active === accountID ? accounts[0].id : entry.active
  return {
    pool: { ...pool, [providerID]: { active, accounts } },
    info: accounts.find((item) => item.id === active)!.info,
  }
}

/**
 * The active account hit a limit. Marks it limited until `until` and makes the next account that is
 * not limited active. Returns the account switched to, or nothing when every account is limited.
 */
export function rotate(pool: Pool, providerID: string, now: number, until: number) {
  const entry = pool[providerID]
  if (!entry || entry.accounts.length < 2) return undefined
  const index = entry.accounts.findIndex((item) => item.id === entry.active)
  const accounts = entry.accounts.map((item) => (item.id === entry.active ? { ...item, limitedUntil: until } : item))
  for (let step = 1; step < accounts.length; step++) {
    const candidate = accounts[(index + step + accounts.length) % accounts.length]
    if (candidate.limitedUntil !== undefined && candidate.limitedUntil > now) continue
    const next = { ...candidate, limitedUntil: undefined }
    return {
      pool: {
        ...pool,
        [providerID]: { active: next.id, accounts: accounts.map((item) => (item.id === next.id ? next : item)) },
      },
      from: entry.accounts[index]?.label,
      to: next,
    }
  }
  return { pool: { ...pool, [providerID]: { ...entry, accounts } }, from: entry.accounts[index]?.label, to: undefined }
}

export type AccountView = {
  id: string
  label: string
  kind: Info["type"]
  added: number
  active: boolean
  limitedUntil?: number
}

/** What the app may see: no secrets. */
export function view(pool: Pool, now: number): Record<string, AccountView[]> {
  return Object.fromEntries(
    Object.entries(pool).map(([providerID, entry]) => [
      providerID,
      entry.accounts.map((account) => ({
        id: account.id,
        label: account.label,
        kind: account.info.type,
        added: account.added,
        active: account.id === entry.active,
        ...(account.limitedUntil !== undefined && account.limitedUntil > now
          ? { limitedUntil: account.limitedUntil }
          : {}),
      })),
    ]),
  )
}
