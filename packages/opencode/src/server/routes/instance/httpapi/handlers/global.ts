import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Account } from "@/account/account"
import { AccountID, OrgID, type Login } from "@/account/schema"
import { errorMessage } from "@/util/error"
import * as ModFreeTier from "@/mod/free-tier"
import { BUILT_IN_PROMPTS, upstreamPrompts } from "@/mod/prompts"
import { Database } from "@opencode-ai/core/database/database"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { AccountPool } from "@/auth/account-pool"
import { randomUUID } from "node:crypto"
import { Duration, Effect, Option, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import {
  GlobalAccountLoginInput,
  GlobalAccountLogoutInput,
  GlobalAccountPollInput,
  GlobalAccountSwitchInput,
  GlobalConfigRemoveInput,
  GlobalUpgradeInput,
  ModAccountAddInput,
  ModAccountInput,
} from "../groups/global"

// Same default as `opencode account login`.
const DEFAULT_CONSOLE_URL = "https://opencode.ai/console"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function eventResponse() {
  return Effect.gen(function* () {
    yield* Effect.logInfo("global event connected")
    const events = Stream.callback<GlobalBusEvent>((queue) => {
      const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
    })
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
    )

    return HttpServerResponse.stream(
      Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.logInfo("global event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const account = yield* Account.Service
    const database = yield* Database.Service
    const modelsDev = yield* ModelsDev.Service
    const accountPool = yield* AccountPool.Service
    const bridge = yield* EffectBridge.make()

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return yield* eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const configRemove = Effect.fn("GlobalHttpApi.configRemove")(function* (ctx: {
      payload: typeof GlobalConfigRemoveInput.Type
    }) {
      const result = yield* config.removeGlobal(ctx.payload.path)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return HttpServerResponse.jsonUnsafe(
          { success: false as const, error: "Unknown installation method" },
          { status: 400 },
        )
      }
      const target = ctx.payload.target
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ success: true as const, version: target }),
        Effect.catch((err) =>
          Effect.succeed({
            success: false as const,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      )
      if (!result.success) return HttpServerResponse.jsonUnsafe(result, { status: 500 })
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return HttpServerResponse.jsonUnsafe(result)
    })

    // Device sign-ins in progress, keyed by an opaque id so the device code never leaves the
    // server. Entries are dropped once they finish or expire.
    const pendingLogins = new Map<string, { login: Login; expiresAt: number }>()
    // Signing in or out changes which Console org manages providers, so instances reload.
    const reloadInstances = () => bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))

    const accountList = Effect.fn("GlobalHttpApi.accountList")(function* () {
      const [accounts, active] = yield* Effect.all([account.list(), account.active()], { concurrency: 2 }).pipe(
        Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({}))),
      )
      // Orgs come from the Console; listing accounts still works offline, just without them.
      const groups = yield* account.orgsByAccount().pipe(Effect.catch(() => Effect.succeed([])))
      const orgs = new Map(groups.map((group) => [group.account.id, group.orgs]))
      const activeID = Option.getOrUndefined(active)?.id
      return {
        accounts: accounts.map((item) => ({
          id: item.id,
          email: item.email,
          url: item.url,
          active: item.id === activeID,
          activeOrgID: item.active_org_id,
          orgs: (orgs.get(item.id) ?? []).map((org) => ({ id: org.id, name: org.name })),
        })),
      }
    })

    const accountSwitch = Effect.fn("GlobalHttpApi.accountSwitch")(function* (ctx: {
      payload: typeof GlobalAccountSwitchInput.Type
    }) {
      const accountID = AccountID.make(ctx.payload.accountID)
      const orgID = yield* ctx.payload.orgID
        ? Effect.succeed(Option.some(OrgID.make(ctx.payload.orgID)))
        : account.list().pipe(
            Effect.map((accounts) =>
              Option.fromNullishOr(accounts.find((item) => item.id === accountID)?.active_org_id),
            ),
            Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))),
          )
      yield* account.use(accountID, orgID).pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      reloadInstances()
      return true
    })

    const accountLogin = Effect.fn("GlobalHttpApi.accountLogin")(function* (ctx: {
      payload: typeof GlobalAccountLoginInput.Type
    }) {
      return yield* account.login(ctx.payload.url ?? DEFAULT_CONSOLE_URL).pipe(
        Effect.map((login) => {
          const id = randomUUID()
          const expiresInSeconds = Duration.toSeconds(login.expiry)
          pendingLogins.set(id, { login, expiresAt: Date.now() + expiresInSeconds * 1000 })
          return {
            success: true as const,
            id,
            verificationUrl: login.url,
            userCode: login.user,
            intervalSeconds: Duration.toSeconds(login.interval),
            expiresInSeconds,
          }
        }),
        Effect.catch((err) => Effect.succeed({ success: false as const, error: errorMessage(err) })),
      )
    })

    const accountLoginPoll = Effect.fn("GlobalHttpApi.accountLoginPoll")(function* (ctx: {
      payload: typeof GlobalAccountPollInput.Type
    }) {
      const entry = pendingLogins.get(ctx.payload.id)
      if (!entry) return { status: "expired" as const }
      if (Date.now() > entry.expiresAt) {
        pendingLogins.delete(ctx.payload.id)
        return { status: "expired" as const }
      }
      const result = yield* account
        .poll(entry.login)
        .pipe(Effect.catch((err) => Effect.succeed({ _tag: "Failed" as const, error: errorMessage(err) })))
      if (result._tag === "PollPending") return { status: "pending" as const }
      if (result._tag === "PollSlow") return { status: "slow_down" as const }
      pendingLogins.delete(ctx.payload.id)
      if (result._tag === "PollSuccess") {
        reloadInstances()
        return { status: "success" as const, email: result.email }
      }
      if (result._tag === "PollExpired") return { status: "expired" as const }
      if (result._tag === "PollDenied") return { status: "denied" as const }
      return { status: "error" as const, error: result._tag === "Failed" ? result.error : errorMessage(result.cause) }
    })

    const accountLogout = Effect.fn("GlobalHttpApi.accountLogout")(function* (ctx: {
      payload: typeof GlobalAccountLogoutInput.Type
    }) {
      yield* account
        .remove(AccountID.make(ctx.payload.accountID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      reloadInstances()
      return true
    })

    const modFreeTier = Effect.fn("GlobalHttpApi.modFreeTier")(function* () {
      const [result, ip] = yield* Effect.all(
        [
          ModFreeTier.usage(Date.now()).pipe(Effect.provideService(Database.Service, database)),
          Effect.promise(ModFreeTier.publicIp),
        ],
        { concurrency: 2 },
      )
      return { ...result, ip: ip.ip ?? null, ipError: ip.error ?? null }
    })

    const modPrompts = Effect.fn("GlobalHttpApi.modPrompts")(function* () {
      return { prompts: BUILT_IN_PROMPTS.map((prompt) => ({ ...prompt })) }
    })

    const modPromptsUpstream = Effect.fn("GlobalHttpApi.modPromptsUpstream")(function* () {
      return { prompts: yield* Effect.promise(upstreamPrompts) }
    })

    // The model picker calls this each time it opens. The catalogs reload from the new download
    // and publish catalog.updated, which makes the app refetch its provider lists.
    const modModelsRefresh = Effect.fn("GlobalHttpApi.modModelsRefresh")(function* () {
      yield* modelsDev.refresh(true)
      return true
    })

    // OpenCode Mod: provider accounts. Account data errors become 400s rather than crashes.
    const modAccounts = Effect.fn("GlobalHttpApi.modAccounts")(function* () {
      return yield* accountPool.list().pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
    })
    const modAccountsAdd = Effect.fn("GlobalHttpApi.modAccountsAdd")(function* (ctx: {
      payload: typeof ModAccountAddInput.Type
    }) {
      yield* accountPool
        .beginAdd(ctx.payload.providerID)
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })
    const modAccountsSelect = Effect.fn("GlobalHttpApi.modAccountsSelect")(function* (ctx: {
      payload: typeof ModAccountInput.Type
    }) {
      return yield* accountPool
        .select(ctx.payload.providerID, ctx.payload.accountID)
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
    })
    const modAccountsRemove = Effect.fn("GlobalHttpApi.modAccountsRemove")(function* (ctx: {
      payload: typeof ModAccountInput.Type
    }) {
      return yield* accountPool
        .remove(ctx.payload.providerID, ctx.payload.accountID)
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("configRemove", configRemove)
      .handle("dispose", dispose)
      .handle("upgrade", upgrade)
      .handle("accountList", accountList)
      .handle("accountLogin", accountLogin)
      .handle("accountLoginPoll", accountLoginPoll)
      .handle("accountLogout", accountLogout)
      .handle("accountSwitch", accountSwitch)
      .handle("modFreeTier", modFreeTier)
      .handle("modPrompts", modPrompts)
      .handle("modPromptsUpstream", modPromptsUpstream)
      .handle("modModelsRefresh", modModelsRefresh)
      .handle("modAccounts", modAccounts)
      .handle("modAccountsAdd", modAccountsAdd)
      .handle("modAccountsSelect", modAccountsSelect)
      .handle("modAccountsRemove", modAccountsRemove)
  }),
)
