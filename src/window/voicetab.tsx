import { createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Voice, type VoiceSettings } from "../voice/contract"
import type definition from "./index"
import { ErrorText, errorMessage, Field, Row } from "./shared"
import { Button, Select, Switch, TextInput, useExtension } from "./ui"

// Transcription services with an OpenAI-compatible /audio/transcriptions endpoint.
const PRESETS = [
  { id: "groq", title: "Groq (fast, free tier)", baseURL: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
  { id: "openai", title: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini-transcribe" },
  { id: "local", title: "Local Whisper server (Speaches)", baseURL: "http://localhost:8000/v1", model: "Systran/faster-whisper-small" },
] as const

export default function VoiceTab() {
  const ctx = useExtension<typeof definition>()
  const voice = ctx.main(Voice)
  const [draft, setDraft] = createStore<{ value?: VoiceSettings }>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [heard, setHeard] = createSignal<string>()

  const state = () => voice.state()
  const current = () => draft.value ?? state()?.settings
  const edit = (patch: Partial<VoiceSettings>) => {
    const base = current()
    if (base) setDraft("value", { ...base, ...patch })
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    setBusy(true)
    try {
      await fn()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const validate = (value: VoiceSettings) => {
    if (!/^https?:\/\/\S+$/i.test(value.baseURL.trim())) throw new Error(ctx.t("providers.baseURL.invalid"))
    if (!value.model.trim()) throw new Error(ctx.t("voice.model.required"))
    if (!value.shortcut.trim()) throw new Error(ctx.t("voice.shortcut.required"))
  }

  // The switch saves at once, with the saved settings; edits to the other fields wait for Save.
  const setEnabled = (enabled: boolean) =>
    act(async () => {
      const saved = state()?.settings
      if (!saved) return
      await voice.configure({ ...saved, enabled })
      if (draft.value) setDraft("value", { ...draft.value, enabled })
    })

  const save = () =>
    act(async () => {
      const value = draft.value
      if (!value) return
      validate(value)
      await voice.configure(value)
      setDraft("value", undefined)
    })

  const test = () =>
    act(async () => {
      setHeard(undefined)
      if (draft.value) {
        validate(draft.value)
        await voice.configure(draft.value)
        setDraft("value", undefined)
      }
      setHeard(await voice.test())
    })

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("voice.description")}</p>

      <Show when={current()} fallback={<p class="text-12-regular text-v2-text-text-muted">{ctx.t("update.loading")}</p>}>
        {(value) => (
          <>
            <div data-component="settings-list">
              <Row title={ctx.t("voice.enable")} description={ctx.t("voice.enable.description")}>
                <Switch hideLabel checked={state()?.settings.enabled ?? false} disabled={busy()} onChange={(on) => void setEnabled(on)}>
                  {ctx.t("voice.enable")}
                </Switch>
              </Row>
              <Row title={ctx.t("voice.shortcut")} description={ctx.t("voice.shortcut.description")}>
                <TextInput value={value().shortcut} onInput={(event) => edit({ shortcut: event.currentTarget.value })} />
              </Row>
              <Row title={ctx.t("voice.autoSend")} description={ctx.t("voice.autoSend.description")}>
                <Switch hideLabel checked={value().autoSend} onChange={(autoSend) => edit({ autoSend })}>
                  {ctx.t("voice.autoSend")}
                </Switch>
              </Row>
              <Row title={ctx.t("voice.speak")} description={ctx.t("voice.speak.description")}>
                <Switch hideLabel checked={value().speakReplies} onChange={(speakReplies) => edit({ speakReplies })}>
                  {ctx.t("voice.speak")}
                </Switch>
              </Row>
              <Row title={ctx.t("voice.rate")} description={ctx.t("voice.rate.description")}>
                <Select
                  options={[0.8, 1, 1.2, 1.5]}
                  current={value().rate}
                  label={(item) => `${item}×`}
                  value={(item) => String(item)}
                  onSelect={(item) => item && edit({ rate: item })}
                />
              </Row>
            </div>

            <h3 class="settings-section-title">{ctx.t("voice.service")}</h3>
            <div data-component="settings-list">
              <Row title={ctx.t("voice.preset")} description={ctx.t("voice.preset.description")}>
                <Select
                  options={PRESETS}
                  placeholder={ctx.t("template")}
                  label={(item) => item.title}
                  value={(item) => item.id}
                  onSelect={(item) => item && edit({ baseURL: item.baseURL, model: item.model })}
                />
              </Row>
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={ctx.t("providers.baseURL")}>
                <TextInput value={value().baseURL} onInput={(event) => edit({ baseURL: event.currentTarget.value })} />
              </Field>
              <Field label={ctx.t("model")}>
                <TextInput value={value().model} onInput={(event) => edit({ model: event.currentTarget.value })} />
              </Field>
              <Field label={ctx.t("providers.apiKey")} hint={ctx.t("voice.key.hint")}>
                <TextInput type="password" value={value().apiKey} onInput={(event) => edit({ apiKey: event.currentTarget.value })} />
              </Field>
              <Field label={ctx.t("voice.language")} hint={ctx.t("voice.language.hint")}>
                <TextInput value={value().language} placeholder="en" onInput={(event) => edit({ language: event.currentTarget.value })} />
              </Field>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <Button variant="neutral" disabled={busy()} onClick={() => void test()}>
                {busy() && state()?.phase === "listening" ? ctx.t("voice.test.listening") : ctx.t("voice.test")}
              </Button>
              <div class="flex items-center gap-2">
                <Button variant="ghost" disabled={!draft.value || busy()} onClick={() => setDraft("value", undefined)}>
                  {ctx.t("cancel")}
                </Button>
                <Button variant="submit" disabled={!draft.value || busy()} onClick={() => void save()}>
                  {ctx.t("save")}
                </Button>
              </div>
            </div>

            <Show when={heard()}>
              <p class="text-12-regular text-v2-text-text-base">{ctx.t("voice.test.heard", { text: heard()! })}</p>
            </Show>
          </>
        )}
      </Show>

      <ErrorText message={error() ?? state()?.error} />
    </div>
  )
}
