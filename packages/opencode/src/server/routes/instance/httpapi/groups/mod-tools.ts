import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

// OpenCode Mod: hooks (user shell commands on agent events) and auto memory.

const HookEvent = Schema.Literals([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionIdle",
  "PermissionAsked",
  "SessionError",
])

const ModHook = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  event: HookEvent,
  matcher: Schema.optional(Schema.String),
  command: Schema.String,
  timeout: Schema.optional(Schema.Finite),
  enabled: Schema.Boolean,
}).annotate({ identifier: "ModHook" })

const ModHookSaveResult = Schema.Union([
  Schema.Struct({ success: Schema.Literal(true), hooks: Schema.Array(ModHook) }),
  Schema.Struct({ success: Schema.Literal(false), error: Schema.String }),
]).annotate({ identifier: "ModHookSaveResult" })

const ModHookTestResult = Schema.Struct({ code: Schema.Finite, stdout: Schema.String, stderr: Schema.String }).annotate(
  {
    identifier: "ModHookTestResult",
  },
)

const ModMemoryEntry = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(["global", "project"]),
  project: Schema.optional(Schema.String),
  text: Schema.String,
  created: Schema.Finite,
  updated: Schema.Finite,
}).annotate({ identifier: "ModMemoryEntry" })

const ModMemoryList = Schema.Struct({ enabled: Schema.Boolean, entries: Schema.Array(ModMemoryEntry) }).annotate({
  identifier: "ModMemoryList",
})

const ModMemoryResult = Schema.Union([
  Schema.Struct({ success: Schema.Literal(true), entry: ModMemoryEntry }),
  Schema.Struct({ success: Schema.Literal(false), error: Schema.String }),
]).annotate({ identifier: "ModMemoryResult" })

export const HookSaveInput = Schema.Struct({ hooks: Schema.Array(ModHook) })
export const HookTestInput = Schema.Struct({
  command: Schema.String,
  event: HookEvent,
  directory: Schema.optional(Schema.String),
})
export const MemorySaveInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  text: Schema.String,
  scope: Schema.Literals(["global", "project"]),
  project: Schema.optional(Schema.String),
})
export const MemoryIDInput = Schema.Struct({ id: Schema.String })
export const MemoryEnabledInput = Schema.Struct({ enabled: Schema.Boolean })

const doc = (identifier: string, summary: string) => OpenApi.annotations({ identifier, summary, description: summary })

export const ModToolsApi = HttpApi.make("modTools").add(
  HttpApiGroup.make("modTools")
    .add(
      HttpApiEndpoint.get("hooks", "/global/mod/hooks", {
        success: described(Schema.Array(ModHook), "Hooks"),
      }).annotateMerge(doc("global.mod.hooks", "List hooks")),
      HttpApiEndpoint.post("hooksSave", "/global/mod/hooks/save", {
        payload: HookSaveInput,
        success: described(ModHookSaveResult, "Saved hooks or the reason they were refused"),
      }).annotateMerge(doc("global.mod.hooksSave", "Replace the hook list")),
      HttpApiEndpoint.post("hooksTest", "/global/mod/hooks/test", {
        payload: HookTestInput,
        success: described(ModHookTestResult, "What the command printed and its exit code"),
      }).annotateMerge(doc("global.mod.hooksTest", "Run a hook command once with sample input")),
      HttpApiEndpoint.get("memory", "/global/mod/memory", {
        success: described(ModMemoryList, "Memory"),
      }).annotateMerge(doc("global.mod.memory", "List saved memories")),
      HttpApiEndpoint.post("memorySave", "/global/mod/memory/save", {
        payload: MemorySaveInput,
        success: described(ModMemoryResult, "Saved memory or the reason it was refused"),
      }).annotateMerge(doc("global.mod.memorySave", "Add or edit a memory")),
      HttpApiEndpoint.post("memoryRemove", "/global/mod/memory/remove", {
        payload: MemoryIDInput,
        success: described(Schema.Boolean, "Removed"),
      }).annotateMerge(doc("global.mod.memoryRemove", "Delete a memory")),
      HttpApiEndpoint.post("memoryEnabled", "/global/mod/memory/enabled", {
        payload: MemoryEnabledInput,
        success: described(Schema.Boolean, "Saved"),
      }).annotateMerge(doc("global.mod.memoryEnabled", "Turn auto memory on or off")),
    )
    .annotateMerge(OpenApi.annotations({ title: "modTools", description: "Hooks and memory routes." })),
)
