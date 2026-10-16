// OpenCode Mod: actions on the per-provider account pool (see ./accounts).
//
// auth.json always holds the active account. These actions update the pool, then write the account
// that should be active through Auth.set; its pool hook recognises that account and keeps it active,
// so the pool and auth.json never disagree.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Context, Effect, Layer } from "effect"
import { Auth } from "."
import * as Accounts from "./accounts"

export interface Interface {
  readonly list: () => Effect.Effect<Record<string, Accounts.AccountView[]>, Auth.AuthError>
  /** The next login for this provider adds an account instead of replacing the current one. */
  readonly beginAdd: (providerID: string) => Effect.Effect<void, Auth.AuthError>
  readonly select: (providerID: string, accountID: string) => Effect.Effect<boolean, Auth.AuthError>
  readonly remove: (providerID: string, accountID: string) => Effect.Effect<boolean, Auth.AuthError>
  /**
   * The active account hit a limit: mark it limited until `until` and make the next usable account
   * active. Returns that account's label, or nothing when no other account is usable.
   */
  readonly rotate: (providerID: string, until: number) => Effect.Effect<string | undefined, Auth.AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AccountPool") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const auth = yield* Auth.Service

    const load = Effect.fn("AccountPool.load")(function* () {
      return Accounts.parsePool(yield* fsys.readJson(Auth.poolFile).pipe(Effect.orElseSucceed(() => ({}))))
    })
    const save = (pool: Accounts.Pool) =>
      fsys
        .writeJson(Auth.poolFile, pool, 0o600)
        .pipe(Effect.mapError((cause) => new Auth.AuthError({ message: "Failed to write account data", cause })))

    return Service.of({
      list: Effect.fn("AccountPool.list")(function* () {
        return Accounts.view(yield* load(), Date.now())
      }),
      beginAdd: Effect.fn("AccountPool.beginAdd")(function* (providerID) {
        const current = yield* auth.get(providerID)
        yield* save(Accounts.beginAdd(yield* load(), providerID, current, Date.now(), Accounts.newID))
      }),
      select: Effect.fn("AccountPool.select")(function* (providerID, accountID) {
        const result = Accounts.select(yield* load(), providerID, accountID)
        if (!result) return false
        yield* save(result.pool)
        yield* auth.set(providerID, result.info)
        return true
      }),
      remove: Effect.fn("AccountPool.remove")(function* (providerID, accountID) {
        const result = Accounts.drop(yield* load(), providerID, accountID)
        if (!result) return false
        yield* save(result.pool)
        if (result.info) yield* auth.set(providerID, result.info)
        else yield* auth.remove(providerID)
        return true
      }),
      rotate: Effect.fn("AccountPool.rotate")(function* (providerID, until) {
        const result = Accounts.rotate(yield* load(), providerID, Date.now(), until)
        if (!result) return undefined
        yield* save(result.pool)
        if (!result.to) return undefined
        yield* auth.set(providerID, result.to.info)
        return result.to.label
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, Auth.node] })

export * as AccountPool from "./account-pool"
