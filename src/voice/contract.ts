import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

// Voice runs in the desktop app's main process (the global shortcut, the microphone, transcription); each window
// shows its state above the composer and receives what was said.

export const VoiceSettings = Schema.Struct({
  enabled: Schema.Boolean,
  shortcut: Schema.String,
  baseURL: Schema.String,
  apiKey: Schema.String,
  model: Schema.String,
  language: Schema.String,
  autoSend: Schema.Boolean,
  speakReplies: Schema.Boolean,
  rate: Schema.Number,
})
export type VoiceSettings = typeof VoiceSettings.Type

export const VoiceState = Schema.Struct({
  settings: VoiceSettings,
  phase: Schema.Literals(["idle", "listening", "transcribing", "speaking"]),
  /** The last failure: no microphone, the endpoint refused, the shortcut is taken. */
  error: Schema.optional(Schema.String),
  /** The global shortcut is registered. */
  shortcutActive: Schema.Boolean,
}).annotate({ identifier: "Mod.VoiceState" })
export type VoiceState = typeof VoiceState.Type

export const Voice = Ipc.define({
  id: "opencode-mod.voice",
  state: VoiceState,
  methods: {
    /** Starts listening, or stops and transcribes. */
    toggle: {},
    /** Stops listening and drops the recording. */
    cancel: {},
    configure: { input: VoiceSettings, output: VoiceState },
    /** Records a few seconds and returns the transcript, to check the microphone and the endpoint. */
    test: { output: Schema.String },
    speak: { input: Schema.String },
    hush: {},
  },
  events: {
    /** What was said, sent to the window that started listening. */
    transcript: Schema.Struct({ text: Schema.String }),
  },
})
