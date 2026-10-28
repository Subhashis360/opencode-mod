import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode/plugin/gui"
import { BrowserWindow, globalShortcut, session, systemPreferences } from "electron"
import { Path } from "../server/paths"
import { ModSettings } from "../server/settings"
import { Voice, type VoiceSettings, type VoiceState } from "./contract"

// Push-to-talk in the main process: the shortcut works while any app has focus. A hidden page of the plugin's own
// records the microphone (only it is granted the microphone) and speaks replies with the system voices; an
// OpenAI-compatible /audio/transcriptions endpoint (Groq, OpenAI, a local Whisper server) turns speech into text.

const MAX_SECONDS = 120
const TEST_SECONDS = 4
const PARTITION = "opencode-mod-voice"

const PAGE = `<!doctype html><meta charset="utf-8"><title>OpenCode Mod voice</title><script>
let recorder, stream, chunks = [], started = 0
window.ocmStart = async () => {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  chunks = []
  const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm"
  recorder = new MediaRecorder(stream, { mimeType: type })
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data)
  recorder.start(250)
  started = Date.now()
  return true
}
window.ocmStop = (keep) => new Promise((resolve) => {
  if (!recorder || recorder.state === "inactive") return resolve("")
  recorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop())
    if (!keep || Date.now() - started < 400) return resolve("")
    const bytes = new Uint8Array(await new Blob(chunks, { type: "audio/webm" }).arrayBuffer())
    let text = ""
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    resolve(btoa(text))
  }
  recorder.stop()
})
window.ocmSpeak = (text, rate) => new Promise((resolve) => {
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.onend = utterance.onerror = () => resolve(true)
  speechSynthesis.speak(utterance)
})
window.ocmHush = () => speechSynthesis.cancel()
</script>`

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const toSettings = (value: ModSettings.Voice): VoiceSettings => ({ ...value })

/** Voice input and spoken replies, once per app. */
export function setupVoice(ctx: Parameters<Plugin.MainSetup>[0]) {
  let settings: VoiceSettings = toSettings(ModSettings.DEFAULTS.voice)
  let phase: VoiceState["phase"] = "idle"
  let error: string | undefined
  let shortcut = ""
  let target: number | undefined
  let page: BrowserWindow | undefined
  let limit: ReturnType<typeof setTimeout> | undefined

  const state = (): VoiceState => ({
    settings,
    phase,
    shortcutActive: !!shortcut,
    ...(error ? { error } : {}),
  })

  const provider = ctx.provide(Voice, {
    state,
    toggle: (_, caller) => toggle(caller.window),
    cancel: () => stop(false).then(() => undefined),
    configure: async (input) => {
      const saved = await ModSettings.save({ voice: input })
      apply(saved.voice)
      return state()
    },
    test: () => test(),
    speak: (text) => speak(text),
    hush: () => hush(),
  })

  let idle: ReturnType<typeof setTimeout> | undefined

  const close = () => {
    clearTimeout(idle)
    if (page && !page.isDestroyed()) page.destroy()
    page = undefined
  }

  // The hidden page goes when it has been idle a while: a window left open would keep the app from quitting when the
  // user closes its last window.
  const changed = () => {
    clearTimeout(idle)
    if (phase === "idle") idle = setTimeout(close, 30_000)
    if (!ctx.signal.aborted) provider.changed()
  }

  ctx.onCleanup(
    ctx.windows.on("close", () =>
      setImmediate(() => {
        if (!ctx.windows.list().some((window) => !window.isDestroyed())) close()
      }),
    ),
  )

  const fail = (cause: unknown) => {
    error = message(cause)
    phase = "idle"
    changed()
    ctx.log.write("warn", "OpenCode Mod voice failed", { error })
  }

  async function recorder() {
    if (page && !page.isDestroyed()) return page
    const voiceSession = session.fromPartition(PARTITION)
    voiceSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === "media"))
    voiceSession.setPermissionCheckHandler((_, permission) => permission === "media")
    // A file page is a secure context, which the microphone needs.
    const file = path.join(Path.state, "opencode-mod-voice.html")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, PAGE)
    page = new BrowserWindow({
      show: false,
      width: 240,
      height: 120,
      skipTaskbar: true,
      webPreferences: { partition: PARTITION, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    await page.loadFile(file)
    return page
  }

  async function start(window: number | undefined) {
    if (!settings.baseURL.trim() || !settings.model.trim()) throw new Error("Set the transcription service in Mod → Voice")
    if (process.platform === "darwin" && !(await systemPreferences.askForMediaAccess("microphone")))
      throw new Error("OpenCode has no access to the microphone (System Settings → Privacy → Microphone)")
    const view = await recorder()
    await view.webContents.executeJavaScript("window.ocmHush(); window.ocmStart()", true)
    target = window
    error = undefined
    phase = "listening"
    changed()
    clearTimeout(limit)
    limit = setTimeout(() => void finish(), MAX_SECONDS * 1000)
  }

  /** Stops recording; with `keep`, returns the audio. */
  async function stop(keep: boolean) {
    clearTimeout(limit)
    if (phase !== "listening" || !page || page.isDestroyed()) return undefined
    const base64: string = await page.webContents.executeJavaScript(`window.ocmStop(${keep})`, true)
    phase = "idle"
    changed()
    return base64 ? Buffer.from(base64, "base64") : undefined
  }

  async function transcribe(audio: Buffer) {
    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/webm" }), "speech.webm")
    form.append("model", settings.model.trim())
    form.append("response_format", "json")
    if (settings.language.trim()) form.append("language", settings.language.trim())
    const response = await fetch(`${settings.baseURL.trim().replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: settings.apiKey.trim() ? { authorization: `Bearer ${settings.apiKey.trim()}` } : {},
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok)
      throw new Error(`Transcription failed (${response.status}): ${(await response.text()).slice(0, 200)}`)
    const json = (await response.json()) as { text?: unknown }
    return typeof json.text === "string" ? json.text.trim() : ""
  }

  /** Stops and sends what was said to the window that started listening. */
  async function finish() {
    const window = target
    const audio = await stop(true)
    if (!audio?.length) return
    phase = "transcribing"
    changed()
    try {
      const text = await transcribe(audio)
      phase = "idle"
      changed()
      if (!text) return
      const to = window ?? ctx.windows.focused()?.id ?? ctx.windows.list()[0]?.id
      provider.emit("transcript", { text }, to)
    } catch (cause) {
      fail(cause)
    }
  }

  async function toggle(window: number | undefined) {
    try {
      if (!settings.enabled) throw new Error("Voice is turned off in Mod → Voice")
      if (phase === "listening") return await finish()
      if (phase === "transcribing") return
      await start(window)
    } catch (cause) {
      fail(cause)
    }
  }

  async function test() {
    const view = await recorder()
    if (phase === "listening") await stop(false)
    if (process.platform === "darwin") await systemPreferences.askForMediaAccess("microphone")
    await view.webContents.executeJavaScript("window.ocmStart()", true)
    phase = "listening"
    changed()
    await new Promise((resolve) => setTimeout(resolve, TEST_SECONDS * 1000))
    const base64: string = await view.webContents.executeJavaScript("window.ocmStop(true)", true)
    phase = "transcribing"
    changed()
    try {
      if (!base64) throw new Error("Nothing was recorded; check the microphone")
      const text = await transcribe(Buffer.from(base64, "base64"))
      error = undefined
      return text || "(silence)"
    } catch (cause) {
      error = message(cause)
      throw cause
    } finally {
      phase = "idle"
      changed()
    }
  }

  async function speak(text: string) {
    if (!text.trim()) return
    const view = await recorder()
    phase = phase === "idle" ? "speaking" : phase
    changed()
    try {
      await view.webContents.executeJavaScript(
        `window.ocmSpeak(${JSON.stringify(text.slice(0, 4000))}, ${Number(settings.rate) || 1})`,
        true,
      )
    } finally {
      if (phase === "speaking") phase = "idle"
      changed()
    }
  }

  async function hush() {
    if (page && !page.isDestroyed()) await page.webContents.executeJavaScript("window.ocmHush()", true)
    if (phase === "speaking") phase = "idle"
    changed()
  }

  function unregister() {
    if (shortcut) globalShortcut.unregister(shortcut)
    shortcut = ""
  }

  /** Follows the settings: registers the shortcut while voice is on. */
  function apply(next: ModSettings.Voice) {
    settings = toSettings(next)
    const wanted = settings.enabled ? settings.shortcut.trim() : ""
    if (wanted !== shortcut) {
      unregister()
      if (wanted) {
        try {
          if (globalShortcut.register(wanted, () => void toggle(ctx.windows.focused()?.id))) {
            shortcut = wanted
            if (error?.startsWith("The shortcut")) error = undefined
          } else error = `The shortcut ${wanted} is used by another app; choose another in Mod → Voice`
        } catch (cause) {
          error = `The shortcut ${wanted} is not valid: ${message(cause)}`
        }
      }
    }
    if (!settings.enabled) {
      void stop(false).catch(() => undefined)
      error = undefined
    }
    changed()
  }

  void ModSettings.load()
    .catch(() => ModSettings.DEFAULTS)
    .then((loaded) => {
      if (!ctx.signal.aborted) apply(loaded.voice)
    })

  ctx.onCleanup(() => {
    clearTimeout(limit)
    unregister()
    close()
  })
}
