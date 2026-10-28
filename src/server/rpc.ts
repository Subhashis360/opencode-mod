export * as Mod from "./rpc.js"

import { Schema } from "effect"
import { Rpc } from "@opencode/plugin/rpc"
import { Schedule } from "./schedule/schedule.js"

// This file is shared by the server part and the GUI bundle, so it imports only modules both get from the app.
// Each schema is also a Standard Schema, so the same definition serves the plugin's Effect handlers and the
// desktop window's Promise client.
const portable = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.toStandardSchemaV1(schema)

const optional = Schema.optional

const errors = { failed: portable(Schema.Struct({})) }

/** The Mod settings' view of the global config file: only the keys the Mod settings edit. */
export const ConfigSnapshot = Schema.Struct({
  path: Schema.String,
  exists: Schema.Boolean,
  values: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "Mod.ConfigSnapshot" })
export type ConfigSnapshot = typeof ConfigSnapshot.Type

const segment = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))

export const ConfigWrite = Schema.Struct({
  path: Schema.Array(segment).check(Schema.isMinLength(1)).annotate({
    description: "Where to write, from a top-level key such as agents, commands, permissions or mcp.",
  }),
  value: optional(Schema.Unknown).annotate({ description: "The new value; omitted to remove the entry." }),
})

const Aurora = Schema.Struct({
  enabled: Schema.Boolean,
  color: optional(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/u))),
  background: Schema.Boolean,
})

export const CodeIndexSettings = Schema.Struct({
  enabled: Schema.Boolean,
  embeddings: Schema.Struct({
    enabled: Schema.Boolean,
    baseURL: Schema.String,
    apiKey: Schema.String,
    model: Schema.String,
  }),
})
export type CodeIndexSettings = typeof CodeIndexSettings.Type

/** One project folder's index, as the server part holds it now. */
export const CodeIndexStatus = Schema.Struct({
  root: Schema.String,
  files: Schema.Number,
  chunks: Schema.Number,
  symbols: Schema.Number,
  building: Schema.Boolean,
  done: Schema.Number,
  total: Schema.Number,
  built: optional(Schema.Number),
  error: optional(Schema.String),
  embeddings: optional(
    Schema.Struct({ model: Schema.String, embedded: Schema.Number, running: Schema.Boolean, error: optional(Schema.String) }),
  ),
})
export type CodeIndexStatus = typeof CodeIndexStatus.Type

/** The mod's own settings, with what this machine supports. */
export const Settings = Schema.Struct({
  computerUse: Schema.Boolean,
  stayInTray: Schema.Boolean,
  openAtLogin: Schema.Boolean,
  /** Computer use can run here: Windows, where the desktop helper works. */
  computerSupported: Schema.Boolean,
  aurora: Aurora,
  codeIndex: CodeIndexSettings,
}).annotate({ identifier: "Mod.Settings" })
export type Settings = typeof Settings.Type

export const SettingsWrite = Schema.Struct({
  computerUse: optional(Schema.Boolean),
  stayInTray: optional(Schema.Boolean),
  openAtLogin: optional(Schema.Boolean),
  aurora: optional(Aurora),
  codeIndex: optional(CodeIndexSettings),
})

const TaskID = Schema.Struct({ id: Schema.String })

export const HookEvent = Schema.Literals([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionIdle",
  "PermissionAsked",
  "SessionError",
])

export const Hook = Schema.Struct({
  id: optional(Schema.String),
  name: Schema.String,
  event: HookEvent,
  matcher: optional(Schema.String),
  command: Schema.String,
  timeout: optional(Schema.Number),
  enabled: Schema.Boolean,
}).annotate({ identifier: "Mod.Hook" })
export type Hook = typeof Hook.Type

const HookResult = Schema.Struct({ code: Schema.Number, stdout: Schema.String, stderr: Schema.String })

export const MemoryEntry = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(["global", "project"]),
  project: optional(Schema.String),
  text: Schema.String,
  created: Schema.Number,
  updated: Schema.Number,
}).annotate({ identifier: "Mod.MemoryEntry" })
export type MemoryEntry = typeof MemoryEntry.Type

const Memory = Schema.Struct({ enabled: Schema.Boolean, entries: Schema.Array(MemoryEntry) })

export const SavedPrompt = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  content: Schema.String,
  updated: Schema.Number,
})
export type SavedPrompt = typeof SavedPrompt.Type

export const FetchModels = Schema.Struct({
  baseURL: Schema.String.check(Schema.isMinLength(1)),
  /** The provider's id: without an API key, the key OpenCode saved for it is used. */
  provider: optional(Schema.String),
  apiKey: optional(Schema.String),
  headers: optional(Schema.Record(Schema.String, Schema.String)),
})

export const FetchedModel = Schema.Struct({ id: Schema.String, name: optional(Schema.String) })
export type FetchedModel = typeof FetchedModel.Type

export const Definition = Rpc.define({
  id: "opencode-mod",
  methods: {
    "config.read": { input: portable(Schema.Struct({})), output: portable(ConfigSnapshot), errors },
    "config.write": { input: portable(ConfigWrite), output: portable(ConfigSnapshot), errors },
    "settings.read": { input: portable(Schema.Struct({})), output: portable(Settings), errors },
    "settings.write": { input: portable(SettingsWrite), output: portable(Settings), errors },
    "schedule.list": { input: portable(Schema.Struct({})), output: portable(Schema.Array(Schedule.Task)), errors },
    "schedule.runs": {
      input: portable(Schema.Struct({ taskID: optional(Schema.String) })),
      output: portable(Schema.Array(Schedule.Run)),
      errors,
    },
    "schedule.create": { input: portable(Schedule.TaskInput), output: portable(Schedule.Task), errors },
    "schedule.update": {
      input: portable(Schema.Struct({ id: Schema.String, patch: Schedule.TaskPatch })),
      output: portable(Schedule.Task),
      errors,
    },
    "schedule.remove": { input: portable(TaskID), output: portable(Schema.Void), errors },
    "schedule.run": { input: portable(TaskID), output: portable(Schema.Void), errors },
    "schedule.stop": { input: portable(TaskID), output: portable(Schema.Void), errors },
    "hooks.list": { input: portable(Schema.Struct({})), output: portable(Schema.Array(Hook)), errors },
    "hooks.save": {
      input: portable(Schema.Struct({ hooks: Schema.Array(Hook) })),
      output: portable(Schema.Array(Hook)),
      errors,
    },
    "hooks.test": {
      input: portable(Schema.Struct({ command: Schema.String, event: HookEvent })),
      output: portable(HookResult),
      errors,
    },
    "memory.read": { input: portable(Schema.Struct({})), output: portable(Memory), errors },
    "memory.save": {
      input: portable(
        Schema.Struct({
          id: optional(Schema.String),
          text: Schema.String,
          scope: Schema.Literals(["global", "project"]),
          project: optional(Schema.String),
        }),
      ),
      output: portable(MemoryEntry),
      errors,
    },
    "memory.remove": { input: portable(TaskID), output: portable(Schema.Void), errors },
    "memory.enable": {
      input: portable(Schema.Struct({ enabled: Schema.Boolean })),
      output: portable(Schema.Void),
      errors,
    },
    "prompts.upstream": {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Record(Schema.String, Schema.String)),
      errors,
    },
    "prompts.library": { input: portable(Schema.Struct({})), output: portable(Schema.Array(SavedPrompt)), errors },
    "prompts.keep": {
      input: portable(Schema.Struct({ id: optional(Schema.String), name: Schema.String, content: Schema.String })),
      output: portable(SavedPrompt),
      errors,
    },
    "prompts.drop": { input: portable(TaskID), output: portable(Schema.Void), errors },
    "providers.models": { input: portable(FetchModels), output: portable(Schema.Array(FetchedModel)), errors },
    "codeindex.status": {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Struct({ current: Schema.String, indexes: Schema.Array(CodeIndexStatus) })),
      errors,
    },
    "codeindex.rebuild": { input: portable(Schema.Struct({ root: Schema.String })), output: portable(Schema.Void), errors },
  },
  events: {},
})

export type ScheduleTaskInput = Schedule.TaskInput
export type ScheduleTaskPatch = Schedule.TaskPatch
