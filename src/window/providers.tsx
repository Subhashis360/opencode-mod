import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useModProviders, type ModConfig } from "./data"
import type definition from "./index"
import { compact, formatPairs, isPlainObject, parsePairs, record, text } from "./model"
import {
  EditorActions,
  EditorCard,
  EntryList,
  ErrorText,
  errorMessage,
  Field,
  nameError,
  TabHeader,
  useSave,
} from "./shared"
import { Button, Switch, TextInput, Textarea, useExtension } from "./ui"

// Custom providers in the config's `provider` section, the format OpenCode 1 used and OpenCode 2 still reads, so the
// providers the user already has show up here. Their models can be fetched from the provider's own API.

const PACKAGE = "@ai-sdk/openai-compatible"

type Model = { id: string; name?: string }

type Draft = {
  original?: string
  id: string
  name: string
  baseURL: string
  apiKey: string
  headers: string
  npm: string
  models: Model[]
  selected: string[]
  disabled: boolean
}

type Template = { title: string; id: string; baseURL: string }

const TEMPLATES: readonly Template[] = [
  { title: "Ollama (this computer)", id: "ollama", baseURL: "http://localhost:11434/v1" },
  { title: "LM Studio (this computer)", id: "lmstudio", baseURL: "http://localhost:1234/v1" },
  { title: "OpenRouter", id: "openrouter-custom", baseURL: "https://openrouter.ai/api/v1" },
  { title: "NVIDIA NIM", id: "nvidia-nim", baseURL: "https://integrate.api.nvidia.com/v1" },
  { title: "Together AI", id: "together", baseURL: "https://api.together.xyz/v1" },
]

const empty = (): Draft => ({
  id: "",
  name: "",
  baseURL: "",
  apiKey: "",
  headers: "",
  npm: PACKAGE,
  models: [],
  selected: [],
  disabled: false,
})

function fromConfig(id: string, config: Record<string, unknown>, disabled: readonly string[]): Draft {
  const options = isPlainObject(config.options) ? config.options : {}
  const models = Object.entries(record(config.models)).map(([model, value]) => ({
    id: model,
    ...(text(value.name) && text(value.name) !== model ? { name: text(value.name) } : {}),
  }))

  return {
    original: id,
    id,
    name: text(config.name),
    baseURL: text(options.baseURL) || text(config.api),
    apiKey: text(options.apiKey),
    headers: formatPairs(options.headers),
    npm: text(config.npm) || PACKAGE,
    models,
    selected: models.map((model) => model.id),
    disabled: disabled.includes(id),
  }
}

/** The provider entry to save. Settings this tab does not edit, on the provider and on kept models, stay. */
export function toConfig(draft: Draft, previous: Record<string, unknown> = {}) {
  const { name: _name, npm: _npm, options, models, ...rest } = previous
  const before = record(models)
  const { baseURL: _baseURL, apiKey: _apiKey, headers: _headers, ...otherOptions } = isPlainObject(options)
    ? options
    : {}
  const headers = parsePairs(draft.headers)

  return {
    ...rest,
    ...compact({ name: draft.name.trim() || undefined }),
    npm: draft.npm.trim() || PACKAGE,
    options: {
      ...otherOptions,
      baseURL: draft.baseURL.trim(),
      ...compact({ apiKey: draft.apiKey.trim() || undefined }),
      ...(Object.keys(headers).length ? { headers } : {}),
    },
    models: Object.fromEntries(
      draft.selected.map((id) => [
        id,
        before[id] ?? { name: draft.models.find((model) => model.id === id)?.name ?? id },
      ]),
    ),
  }
}

export default function ProvidersTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)
  const remote = useModProviders()

  const providers = createMemo(() => record(props.config.values().provider))
  const disabledList = createMemo(() => {
    const value = props.config.values().disabled_providers
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  })
  const names = createMemo(() => Object.keys(providers()).sort())

  const [draft, setDraft] = createStore<Draft>(empty())
  const [open, setOpen] = createSignal(false)
  const [showErrors, setShowErrors] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const [manual, setManual] = createSignal("")
  const [fetching, setFetching] = createSignal(false)
  const [fetchNote, setFetchNote] = createSignal<string>()
  const [fetchError, setFetchError] = createSignal<string>()

  const errors = createMemo(() =>
    compact({
      id: nameError(draft.id.trim(), names(), draft.original, ctx.t),
      baseURL: /^https?:\/\/\S+$/i.test(draft.baseURL.trim()) ? undefined : ctx.t("providers.baseURL.invalid"),
      models: draft.selected.length ? undefined : ctx.t("providers.models.required"),
    }),
  )

  const shown = createMemo(() => {
    const query = filter().trim().toLowerCase()
    if (!query) return draft.models
    return draft.models.filter(
      (model) => model.id.toLowerCase().includes(query) || model.name?.toLowerCase().includes(query),
    )
  })

  const isSelected = (id: string) => draft.selected.includes(id)
  const toggle = (id: string, on: boolean) =>
    setDraft("selected", (list) => (on ? (list.includes(id) ? list : [...list, id]) : list.filter((item) => item !== id)))

  const addModels = (models: readonly Model[]) =>
    setDraft("models", (list) => {
      const known = new Set(list.map((model) => model.id))
      return [...list, ...models.filter((model) => !known.has(model.id))]
    })

  const edit = (next: Draft) => {
    save.clear()
    setShowErrors(false)
    setFilter("")
    setManual("")
    setFetchNote(undefined)
    setFetchError(undefined)
    setDraft(next)
    setOpen(true)
  }

  const fetchModels = async () => {
    setFetchNote(undefined)
    setFetchError(undefined)
    if (errors().baseURL) {
      setShowErrors(true)
      return
    }
    setFetching(true)
    try {
      const headers = parsePairs(draft.headers)
      const models = await remote.fetchModels({
        baseURL: draft.baseURL.trim(),
        ...compact({
          provider: (draft.original ?? draft.id.trim()) || undefined,
          apiKey: draft.apiKey.trim() || undefined,
        }),
        ...(Object.keys(headers).length ? { headers } : {}),
      })
      addModels(models)
      setFetchNote(ctx.t("providers.fetched", { count: models.length }))
    } catch (cause) {
      setFetchError(ctx.t("providers.fetch.error", { error: errorMessage(cause) }))
    } finally {
      setFetching(false)
    }
  }

  const addManual = () => {
    const id = manual().trim()
    if (!id) return
    addModels([{ id }])
    toggle(id, true)
    setManual("")
  }

  const saveDisabled = async (remove: readonly string[], add?: string) => {
    const current = disabledList()
    const next = [...current.filter((item) => !remove.includes(item)), ...(add ? [add] : [])]
    if (next.length === current.length && next.every((item, index) => item === current[index])) return true
    return save.run(["disabled_providers"], next.length ? next : undefined)
  }

  const submit = async () => {
    setShowErrors(true)
    if (Object.keys(errors()).length) return

    const id = draft.id.trim()
    const value = toConfig(draft, draft.original ? providers()[draft.original] : undefined)
    if (!(await save.run(["provider", id], value))) return
    if (draft.original && draft.original !== id) await save.run(["provider", draft.original], undefined)
    if (!(await saveDisabled([id, ...(draft.original ? [draft.original] : [])], draft.disabled ? id : undefined)))
      return
    setOpen(false)
  }

  const remove = async (name: string) => {
    if (await save.run(["provider", name], undefined)) await saveDisabled([name])
  }

  const describe = (name: string) => {
    const provider = providers()[name] ?? {}
    const options = isPlainObject(provider.options) ? provider.options : {}
    return [
      text(provider.name),
      text(options.baseURL),
      ctx.t("providers.summary", { count: Object.keys(record(provider.models)).length }),
      ...(disabledList().includes(name) ? [ctx.t("disabled")] : []),
    ]
      .filter(Boolean)
      .join(" · ")
  }

  return (
    <div class="flex flex-col gap-4">
      <TabHeader
        description={ctx.t("providers.description")}
        onNew={() => edit(empty())}
        templates={TEMPLATES}
        templateLabel={(item) => item.title}
        onTemplate={(item) => edit({ ...empty(), id: item.id, name: item.title, baseURL: item.baseURL })}
      />

      <Show when={open()}>
        <EditorCard>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label={ctx.t("providers.id")}
              hint={ctx.t("providers.id.hint")}
              error={showErrors() ? errors().id : undefined}
            >
              <TextInput value={draft.id} onInput={(event) => setDraft("id", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("providers.name")}>
              <TextInput value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>
          </div>

          <Field label={ctx.t("providers.baseURL")} error={showErrors() ? errors().baseURL : undefined}>
            <TextInput
              value={draft.baseURL}
              placeholder="https://api.example.com/v1"
              onInput={(event) => setDraft("baseURL", event.currentTarget.value)}
            />
          </Field>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={ctx.t("providers.apiKey")} hint={ctx.t("providers.apiKey.hint")}>
              <TextInput
                type="password"
                value={draft.apiKey}
                onInput={(event) => setDraft("apiKey", event.currentTarget.value)}
              />
            </Field>
            <Field label={ctx.t("providers.package")}>
              <TextInput value={draft.npm} onInput={(event) => setDraft("npm", event.currentTarget.value)} />
            </Field>
          </div>

          <Field label={ctx.t("providers.headers")} hint={ctx.t("mcp.pairs.placeholder")}>
            <Textarea
              rows={2}
              value={draft.headers}
              onInput={(event) => setDraft("headers", event.currentTarget.value)}
            />
          </Field>

          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-12-medium text-v2-text-text-base">
                {ctx.t("providers.models", { selected: draft.selected.length })}
              </span>
              <Button variant="neutral" disabled={fetching()} onClick={() => void fetchModels()}>
                {fetching() ? ctx.t("providers.fetching") : ctx.t("providers.fetch")}
              </Button>
            </div>
            <Show when={fetchNote()}>
              <p class="text-11-regular text-v2-text-text-muted">{fetchNote()}</p>
            </Show>
            <ErrorText message={fetchError()} />

            <Show
              when={draft.models.length}
              fallback={<p class="text-12-regular text-v2-text-text-muted">{ctx.t("providers.models.empty")}</p>}
            >
              <div class="flex flex-wrap items-center gap-2">
                <TextInput
                  class="min-w-48 flex-1"
                  value={filter()}
                  placeholder={ctx.t("providers.models.filter")}
                  onInput={(event) => setFilter(event.currentTarget.value)}
                />
                <Button
                  variant="ghost"
                  onClick={() => setDraft("selected", (list) => [...new Set([...list, ...shown().map((model) => model.id)])])}
                >
                  {ctx.t("providers.models.all")}
                </Button>
                <Button variant="ghost" onClick={() => setDraft("selected", [])}>
                  {ctx.t("providers.models.none")}
                </Button>
              </div>
              <div class="flex max-h-72 flex-col overflow-y-auto rounded-md border border-v2-border-border-base py-1">
                <For each={shown()}>
                  {(model) => (
                    <label class="flex cursor-pointer items-center gap-2 px-3 py-1 text-12-regular text-v2-text-text-base">
                      <input
                        type="checkbox"
                        checked={isSelected(model.id)}
                        onChange={(event) => toggle(model.id, event.currentTarget.checked)}
                      />
                      <span class="truncate">{model.id}</span>
                      <Show when={model.name}>
                        <span class="truncate text-v2-text-text-muted">{model.name}</span>
                      </Show>
                    </label>
                  )}
                </For>
              </div>
            </Show>
            <ErrorText message={showErrors() ? errors().models : undefined} />

            <div class="flex items-center gap-2">
              <TextInput
                class="flex-1"
                value={manual()}
                placeholder={ctx.t("providers.models.add")}
                onInput={(event) => setManual(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addManual()
                }}
              />
              <Button variant="ghost" onClick={addManual}>
                {ctx.t("providers.models.add.button")}
              </Button>
            </div>
          </div>

          <Switch checked={draft.disabled} onChange={(checked) => setDraft("disabled", checked)}>
            {ctx.t("disabled")}
          </Switch>
          <EditorActions config={props.config} error={save.error()} onSave={submit} onCancel={() => setOpen(false)} />
        </EditorCard>
      </Show>

      <EntryList
        names={names()}
        describe={describe}
        onEdit={(name) => edit(fromConfig(name, providers()[name] ?? {}, disabledList()))}
        onDelete={remove}
      />
    </div>
  )
}
