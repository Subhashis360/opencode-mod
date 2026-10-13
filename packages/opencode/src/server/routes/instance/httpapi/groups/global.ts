import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { EventV2 } from "@opencode-ai/core/event"
import { EventManifest } from "@/event-manifest"
import { InstanceDisposed } from "@/server/event"
import "@opencode-ai/core/account"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import semver from "semver"
import { described } from "./metadata"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const SyncEventSchemas = EventManifest.Latest.values()
  .flatMap((definition) => {
    if (!definition.durable) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        id: EventV2.ID,
        syncEvent: Schema.Struct({
          type: Schema.Literal(EventV2.versionedType(definition.type, definition.durable.version)),
          id: EventV2.ID,
          seq: Schema.Finite,
          aggregateID: Schema.String,
          data: definition.data,
        }),
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventManifest.Latest.values()
      .map((definition) =>
        Schema.Struct({ id: EventV2.ID, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.String.check(
    Schema.makeFilter((value) => (semver.valid(value) === null ? "Expected a semantic version" : undefined)),
  ),
})

// Keyed collections whose entries a client may delete. Patches can only add or overwrite keys.
const REMOVABLE_CONFIG_ROOTS = ["agent", "mcp", "command", "provider", "permission"]

export const GlobalConfigRemoveInput = Schema.Struct({
  path: Schema.Array(Schema.String).check(
    Schema.makeFilter((value) =>
      // `permission` may be a single action string, so it can also be removed as a whole.
      REMOVABLE_CONFIG_ROOTS.includes(value[0]) && value.length >= (value[0] === "permission" ? 1 : 2)
        ? undefined
        : `Expected a path into one of: ${REMOVABLE_CONFIG_ROOTS.join(", ")}`,
    ),
  ),
})

// OpenCode (Console) accounts. The CLI's `opencode account` commands drive the same Account
// service; these routes let a desktop or web client sign in and out without a terminal.
const GlobalAccountOrg = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
}).annotate({ identifier: "GlobalAccountOrg" })

// Several accounts can be signed in at once; `active` marks the one in use and `activeOrgID` its
// org. `orgs` is empty when the Console cannot be reached.
const GlobalAccount = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  url: Schema.String,
  active: Schema.Boolean,
  activeOrgID: Schema.NullOr(Schema.String),
  orgs: Schema.Array(GlobalAccountOrg),
}).annotate({ identifier: "GlobalAccount" })

const GlobalAccountList = Schema.Struct({
  accounts: Schema.Array(GlobalAccount),
}).annotate({ identifier: "GlobalAccountList" })

export const GlobalAccountLoginInput = Schema.Struct({
  url: Schema.optional(Schema.String).annotate({ description: "Console URL, https://opencode.ai/console by default" }),
})

const GlobalAccountLoginStart = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    id: Schema.String,
    verificationUrl: Schema.String,
    userCode: Schema.String,
    intervalSeconds: Schema.Finite,
    expiresInSeconds: Schema.Finite,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
]).annotate({ identifier: "GlobalAccountLoginStart" })

export const GlobalAccountPollInput = Schema.Struct({
  id: Schema.String,
})

const GlobalAccountPollResult = Schema.Struct({
  status: Schema.Literals(["pending", "slow_down", "success", "expired", "denied", "error"]),
  email: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "GlobalAccountPollResult" })

export const GlobalAccountLogoutInput = Schema.Struct({
  accountID: Schema.String,
})

export const GlobalAccountSwitchInput = Schema.Struct({
  accountID: Schema.String,
  orgID: Schema.optional(Schema.String).annotate({
    description: "Org to use; keeps the account's current org if omitted",
  }),
})

// OpenCode Mod: free-tier usage from local history plus the public IP the gateway limits by.
const ModFreeTierRequest = Schema.Struct({
  time: Schema.Finite,
  modelID: Schema.String,
  tokens: Schema.Finite,
  limited: Schema.Boolean,
  failed: Schema.Boolean,
})

const ModFreeTier = Schema.Struct({
  now: Schema.Finite,
  dayStart: Schema.Finite,
  resetAt: Schema.Finite,
  ip: Schema.NullOr(Schema.String),
  ipError: Schema.NullOr(Schema.String),
  requests: Schema.Array(ModFreeTierRequest),
}).annotate({ identifier: "ModFreeTier" })

// OpenCode Mod: the built-in model system prompts, and the same prompts on upstream's dev branch.
const ModPromptList = Schema.Struct({
  prompts: Schema.Array(
    Schema.Struct({ id: Schema.String, title: Schema.String, usedBy: Schema.String, content: Schema.String }),
  ),
}).annotate({ identifier: "ModPromptList" })

const ModUpstreamPrompts = Schema.Struct({
  prompts: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "ModUpstreamPrompts" })

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  configRemove: "/global/config/remove",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
  account: "/global/account",
  accountLogin: "/global/account/login",
  accountLoginPoll: "/global/account/login/poll",
  accountLogout: "/global/account/logout",
  accountSwitch: "/global/account/switch",
  modFreeTier: "/global/mod/free-tier",
  modPrompts: "/global/mod/prompts",
  modPromptsUpstream: "/global/mod/prompts/upstream",
} as const

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenCode server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenCode system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(ConfigV1.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: ConfigV1.Info,
        success: described(ConfigV1.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("configRemove", GlobalPaths.configRemove, {
        payload: GlobalConfigRemoveInput,
        success: described(ConfigV1.Info, "Global config after the removal"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.remove",
          summary: "Remove global configuration entry",
          description:
            "Delete one agent, MCP server, command, provider or permission entry from the global configuration.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: GlobalUpgradeInput,
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade opencode",
          description: "Upgrade opencode to the specified version.",
        }),
      ),
      HttpApiEndpoint.get("accountList", GlobalPaths.account, {
        success: described(GlobalAccountList, "Signed-in OpenCode accounts"),
        error: HttpApiError.InternalServerError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.account.list",
          summary: "List OpenCode accounts",
          description: "List the OpenCode (Console) accounts signed in on this machine and which one is active.",
        }),
      ),
      HttpApiEndpoint.post("accountLogin", GlobalPaths.accountLogin, {
        payload: GlobalAccountLoginInput,
        success: described(GlobalAccountLoginStart, "Device sign-in started"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.account.login",
          summary: "Start OpenCode account sign-in",
          description:
            "Start a device sign-in. Open verificationUrl, enter userCode, then poll /global/account/login/poll.",
        }),
      ),
      HttpApiEndpoint.post("accountLoginPoll", GlobalPaths.accountLoginPoll, {
        payload: GlobalAccountPollInput,
        success: described(GlobalAccountPollResult, "Sign-in status"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.account.loginPoll",
          summary: "Poll OpenCode account sign-in",
          description: "Check whether a device sign-in started with /global/account/login has been approved.",
        }),
      ),
      HttpApiEndpoint.post("accountLogout", GlobalPaths.accountLogout, {
        payload: GlobalAccountLogoutInput,
        success: described(Schema.Boolean, "Signed out"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.account.logout",
          summary: "Sign out of an OpenCode account",
          description: "Remove a signed-in OpenCode account from this machine.",
        }),
      ),
      HttpApiEndpoint.post("accountSwitch", GlobalPaths.accountSwitch, {
        payload: GlobalAccountSwitchInput,
        success: described(Schema.Boolean, "Switched"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.account.switch",
          summary: "Switch the active OpenCode account",
          description: "Make another signed-in account (and optionally one of its orgs) active without signing out.",
        }),
      ),
      HttpApiEndpoint.get("modFreeTier", GlobalPaths.modFreeTier, {
        success: described(ModFreeTier, "Free-tier usage"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.mod.freeTier",
          summary: "Get free-tier usage",
          description:
            "Requests to OpenCode's free models from this machine over the last days, and the public IP the gateway's per-IP daily limit applies to.",
        }),
      ),
      HttpApiEndpoint.get("modPrompts", GlobalPaths.modPrompts, {
        success: described(ModPromptList, "Built-in system prompts"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.mod.prompts",
          summary: "List built-in system prompts",
          description: "The model system prompts bundled with this version and which models use each.",
        }),
      ),
      HttpApiEndpoint.get("modPromptsUpstream", GlobalPaths.modPromptsUpstream, {
        success: described(ModUpstreamPrompts, "Upstream system prompts"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.mod.promptsUpstream",
          summary: "Get upstream system prompts",
          description: "The built-in system prompts as they are now on upstream OpenCode's dev branch.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
