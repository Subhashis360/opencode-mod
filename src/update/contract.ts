import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

// The updater runs once in the desktop app's main process; the Updates tab of every window reads its state and calls it
// over this Ipc.

const optional = Schema.optional

export const Commit = Schema.Struct({ sha: Schema.String, message: Schema.String, date: Schema.String })
export type Commit = typeof Commit.Type

export const Phase = Schema.Literals([
  "idle",
  "checking",
  "current",
  "available",
  "installing",
  "installed",
  "diverged",
  "error",
])
export type Phase = typeof Phase.Type

export const Status = Schema.Struct({
  /** Check on every start and install what is found, in the background. */
  autoUpdate: Schema.Boolean,
  phase: Phase,
  /** `git`: the folder is a clone and is fast-forwarded. `download`: the built files are downloaded from GitHub. */
  method: optional(Schema.Literals(["git", "download"])),
  /** The plugin's folder, from the plugins list of the global config. */
  folder: optional(Schema.String),
  /** The commit the folder is on, when known. */
  installed: optional(Schema.String),
  /** The newest commit on GitHub. */
  latest: optional(Commit),
  /** How many commits the folder is behind, when known. */
  behind: optional(Schema.Number),
  /** When the last check finished. */
  checked: optional(Schema.Number),
  error: optional(Schema.String),
  /** An update was installed since the app started: it is used from the next start. */
  restartNeeded: Schema.Boolean,
}).annotate({ identifier: "Mod.UpdateStatus" })
export type Status = typeof Status.Type

export const Updater = Ipc.define({
  id: "opencode-mod.update",
  state: Status,
  methods: {
    check: { output: Status },
    install: { output: Status },
    setAutoUpdate: { input: Schema.Boolean, output: Status },
    restart: {},
  },
})
