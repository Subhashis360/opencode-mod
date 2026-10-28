import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Mod } from "../server/rpc"
import { useModCodeIndex, useModSettings } from "./data"
import type definition from "./index"
import { ErrorText, errorMessage, Field, Row } from "./shared"
import { Button, Select, Switch, TextInput, useExtension } from "./ui"

type Embeddings = Mod.CodeIndexSettings["embeddings"]

// Embedding services people run: a local one first, so code never has to leave the machine.
const PRESETS = [
  { id: "ollama", title: "Ollama (this computer)", baseURL: "http://localhost:11434/v1", model: "nomic-embed-text" },
  { id: "lmstudio", title: "LM Studio (this computer)", baseURL: "http://localhost:1234/v1", model: "text-embedding-nomic-embed-text-v1.5" },
  { id: "openai", title: "OpenAI", baseURL: "https://api.openai.com/v1", model: "text-embedding-3-small" },
] as const

export default function CodeIndexTab() {
  const ctx = useExtension<typeof definition>()
  const settings = useModSettings()
  const index = useModCodeIndex()
  const [error, setError] = createSignal<string>()
  const [draft, setDraft] = createStore<{ value?: Embeddings }>({})

  const saved = () => settings.query.data?.codeIndex
  const embeddings = () => draft.value ?? saved()?.embeddings
  const edit = (patch: Partial<Embeddings>) => {
    const base = embeddings()
    if (base) setDraft("value", { ...base, ...patch })
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    try {
      await fn()
    } catch (cause) {
      setError(ctx.t("save.error", { error: errorMessage(cause) }))
    }
  }

  const save = (patch: Partial<Mod.CodeIndexSettings>) =>
    act(async () => {
      const current = saved()
      if (!current) return
      await settings.save({ codeIndex: { ...current, ...patch } })
    })

  const saveEmbeddings = () =>
    act(async () => {
      const current = saved()
      const value = embeddings()
      if (!current || !value) return
      if (value.enabled && !/^https?:\/\/\S+$/i.test(value.baseURL.trim())) throw new Error(ctx.t("providers.baseURL.invalid"))
      await settings.save({ codeIndex: { ...current, embeddings: value } })
      setDraft("value", undefined)
    })

  const describe = (item: Mod.CodeIndexStatus) => {
    const parts = [ctx.t("codeindex.counts", { files: item.files, symbols: item.symbols, chunks: item.chunks })]
    if (item.building) parts.push(item.total ? ctx.t("codeindex.building.progress", { done: item.done, total: item.total }) : ctx.t("codeindex.building"))
    else if (item.built) parts.push(ctx.t("codeindex.built", { time: new Date(item.built).toLocaleTimeString() }))
    if (item.embeddings)
      parts.push(
        item.embeddings.error
          ? ctx.t("codeindex.embeddings.error", { error: item.embeddings.error })
          : ctx.t("codeindex.embeddings.count", { embedded: item.embeddings.embedded, chunks: item.chunks, model: item.embeddings.model }) +
              (item.embeddings.running ? ` ${ctx.t("codeindex.embeddings.running")}` : ""),
      )
    if (item.error) parts.push(item.error)
    return parts.join(" · ")
  }

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("codeindex.description")}</p>

      <Show
        when={saved()}
        fallback={<p class="text-12-regular text-v2-text-text-muted">{settings.query.isError ? errorMessage(settings.query.error) : ctx.t("config.loading")}</p>}
      >
        {(value) => (
          <>
            <div data-component="settings-list">
              <Row title={ctx.t("codeindex.enable")} description={ctx.t("codeindex.enable.description")}>
                <Switch hideLabel checked={value().enabled} disabled={settings.saving()} onChange={(enabled) => void save({ enabled })}>
                  {ctx.t("codeindex.enable")}
                </Switch>
              </Row>
            </div>

            <Show when={value().enabled}>
              <h3 class="settings-section-title">{ctx.t("codeindex.projects")}</h3>
              <div data-component="settings-list">
                <Show
                  when={index.status.data?.indexes.length}
                  fallback={
                    <Show when={index.status.data?.current} fallback={<Row title={ctx.t("config.loading")} />}>
                      {(current) => (
                        <Row title={current()} description={ctx.t("codeindex.none")}>
                          <Button variant="neutral" onClick={() => void act(() => index.rebuild(current()))}>
                            {ctx.t("codeindex.now")}
                          </Button>
                        </Row>
                      )}
                    </Show>
                  }
                >
                  <For each={index.status.data?.indexes}>
                    {(item) => (
                      <Row title={item.root} description={describe(item)}>
                        <Button variant="ghost" disabled={item.building} onClick={() => void act(() => index.rebuild(item.root))}>
                          {ctx.t("codeindex.rebuild")}
                        </Button>
                      </Row>
                    )}
                  </For>
                </Show>
              </div>

              <h3 class="settings-section-title">{ctx.t("codeindex.embeddings")}</h3>
              <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("codeindex.embeddings.description")}</p>
              <Show when={embeddings()}>
                {(current) => (
                  <div class="flex flex-col gap-3">
                    <div data-component="settings-list">
                      <Row title={ctx.t("codeindex.embeddings.enable")}>
                        <Switch hideLabel checked={current().enabled} onChange={(enabled) => edit({ enabled })}>
                          {ctx.t("codeindex.embeddings.enable")}
                        </Switch>
                      </Row>
                      <Row title={ctx.t("codeindex.embeddings.preset")}>
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
                        <TextInput value={current().baseURL} onInput={(event) => edit({ baseURL: event.currentTarget.value })} />
                      </Field>
                      <Field label={ctx.t("model")}>
                        <TextInput value={current().model} onInput={(event) => edit({ model: event.currentTarget.value })} />
                      </Field>
                    </div>
                    <Field label={ctx.t("providers.apiKey")} hint={ctx.t("codeindex.embeddings.key.hint")}>
                      <TextInput type="password" value={current().apiKey} onInput={(event) => edit({ apiKey: event.currentTarget.value })} />
                    </Field>
                    <div class="flex justify-end gap-2">
                      <Button variant="ghost" disabled={!draft.value} onClick={() => setDraft("value", undefined)}>
                        {ctx.t("cancel")}
                      </Button>
                      <Button variant="submit" disabled={!draft.value || settings.saving()} onClick={() => void saveEmbeddings()}>
                        {ctx.t("save")}
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
            </Show>
          </>
        )}
      </Show>

      <ErrorText message={error() ?? (index.status.isError ? errorMessage(index.status.error) : undefined)} />
    </div>
  )
}
