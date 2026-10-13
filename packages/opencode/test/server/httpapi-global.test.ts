import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Duration, Effect, Layer, Option } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { Account } from "../../src/account/account"
import {
  AccountID,
  DeviceCode,
  Info,
  Login,
  Org,
  OrgID,
  PollPending,
  PollSuccess,
  UserCode,
} from "../../src/account/schema"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

// A fake Account service: one signed-in account, and a device sign-in that is approved on the
// second poll.
const signedIn = new Info({
  id: AccountID.make("acc-1"),
  email: "dev@example.com",
  url: "https://opencode.ai/console",
  active_org_id: null,
})
const removed: string[] = []
const used: [string, string | null][] = []
let polls = 0
const accountMock = Layer.mock(Account.Service)({
  list: () => Effect.succeed([signedIn]),
  active: () => Effect.succeed(Option.some(signedIn)),
  login: (url: string) =>
    Effect.succeed(
      new Login({
        code: DeviceCode.make("device-code"),
        user: UserCode.make("ABCD-EFGH"),
        url: "https://opencode.ai/device",
        server: url,
        expiry: Duration.minutes(10),
        interval: Duration.seconds(5),
      }),
    ),
  poll: () => Effect.succeed(++polls < 2 ? new PollPending() : new PollSuccess({ email: "dev@example.com" })),
  remove: (id: AccountID) => Effect.sync(() => void removed.push(id)),
  orgsByAccount: () =>
    Effect.succeed([{ account: signedIn, orgs: [new Org({ id: OrgID.make("org-1"), name: "Team" })] }]),
  use: (id: AccountID, org: Option.Option<OrgID>) => Effect.sync(() => void used.push([id, Option.getOrNull(org)])),
})

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(accountMock),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("global HttpApi", () => {
  it.live("upgrades to the requested version", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: "9.9.9" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ success: true, version: "9.9.9" })
    }),
  )

  it.live("rejects invalid upgrade payloads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: 1 }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects invalid upgrade target versions", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: "latest" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects unsupported upgrade content types", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.setBody(HttpBody.text('{"target":"1.0.0"}', "text/plain")),
        HttpClient.execute,
      )

      expect(response.status).toBe(415)
    }),
  )

  it.live("lists signed-in accounts with the active one marked", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get(GlobalPaths.account).pipe(HttpClient.execute)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        accounts: [
          {
            id: "acc-1",
            email: "dev@example.com",
            url: "https://opencode.ai/console",
            active: true,
            activeOrgID: null,
            orgs: [{ id: "org-1", name: "Team" }],
          },
        ],
      })
    }),
  )

  it.live("signs in with a device code and reports success once approved", () =>
    Effect.gen(function* () {
      const started = yield* HttpClientRequest.post(GlobalPaths.accountLogin).pipe(
        HttpClientRequest.bodyJsonUnsafe({}),
        HttpClient.execute,
      )
      const start = (yield* started.json) as { success: boolean; id: string }
      expect(start).toMatchObject({
        success: true,
        userCode: "ABCD-EFGH",
        verificationUrl: "https://opencode.ai/device",
      })
      // The device code itself stays on the server.
      expect(JSON.stringify(start)).not.toContain("device-code")

      const poll = () =>
        HttpClientRequest.post(GlobalPaths.accountLoginPoll).pipe(
          HttpClientRequest.bodyJsonUnsafe({ id: start.id }),
          HttpClient.execute,
          Effect.flatMap((response) => response.json),
        )
      expect(yield* poll()).toEqual({ status: "pending" })
      expect(yield* poll()).toEqual({ status: "success", email: "dev@example.com" })
      // A finished sign-in cannot be polled again.
      expect(yield* poll()).toEqual({ status: "expired" })
    }),
  )

  it.live("signs out of an account", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.accountLogout).pipe(
        HttpClientRequest.bodyJsonUnsafe({ accountID: "acc-1" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect(removed).toEqual(["acc-1"])
    }),
  )

  it.live("switches to another account and org without signing out", () =>
    Effect.gen(function* () {
      const removedBefore = removed.length
      const response = yield* HttpClientRequest.post(GlobalPaths.accountSwitch).pipe(
        HttpClientRequest.bodyJsonUnsafe({ accountID: "acc-1", orgID: "org-1" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect(used).toEqual([["acc-1", "org-1"]])
      expect(removed.length).toBe(removedBefore)
    }),
  )
})
