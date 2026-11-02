import { createMemo, createSignal, For, Show } from "solid-js"
import { useModProviders, useOpenCodeCatalog, type ModConfig } from "./data"
import type definition from "./index"
import { isPlainObject, record, text } from "./model"
import { ErrorText, errorMessage, useSave } from "./shared"
import { Button, Switch, TextInput, useExtension } from "./ui"

// The providers OpenCode itself knows (models.dev, connected accounts, plugins), which the app's own Providers page
// lists without their hidden models. Here every model shows, hidden ones can be shown, and a provider's full model
// list can be fetched from its API. Changes go to the config's `providers` section, which OpenCode applies on top.

type CatalogModel = { id: string; name: string; enabled: boolean; status: string }

export default function OpenCodeProviders(props: { config: ModConfig; custom: readonly string[] }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)
  const catalog = useOpenCodeCatalog()
  const remote = useModProviders()

  const [open, setOpen] = createSignal<string>()
  const [filter, setFilter] = createSignal("")
  const [busy, setBusy] = createSignal<string>()
  const [note, setNote] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  const disabledList = createMemo(() => {
    const value = props.config.values().disabled_providers
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  })
  const overrides = createMemo(() => record(props.config.values().providers))

  const providers = createMemo(() => {
    const listed = (catalog.query.data?.providers ?? []).filter((item) => !props.custom.includes(item.id))
    const known = new Set(listed.map((item) => item.id))
    // A disabled provider drops out of OpenCode's list; it stays here so it can be turned back on.
    const off = disabledList()
      .filter((id) => !known.has(id) && !props.custom.includes(id))
      .map((id) => ({ id, name: id, settings: undefined as Record<string, unknown> | undefined }))
    return [...listed, ...off].sort((a, b) => a.name.localeCompare(b.name))
  })

  const models = createMemo(() => {
    const result = new Map<string, CatalogModel[]>()
    for (const model of catalog.query.data?.models ?? []) {
      const list = result.get(model.providerID) ?? []
      list.push({ id: model.id, name: model.name, enabled: model.enabled, status: model.status })
      result.set(model.providerID, list)
    }
    for (const list of result.values()) list.sort((a, b) => a.id.localeCompare(b.id))
    return result
  })

  const configured = (provider: string) => record(overrides()[provider]?.models)

  /** What the config says about a model, else what OpenCode decided. */
  const shown = (provider: string, model: CatalogModel) => {
    const value = configured(provider)[model.id]?.disabled
    return typeof value === "boolean" ? !value : model.enabled
  }

  const visible = (provider: string) => {
    const query = filter().trim().toLowerCase()
    const list = models().get(provider) ?? []
    if (!query) return list
    return list.filter((model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query))
  }

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    setNote(undefined)
    setError(undefined)
    try {
      await fn()
      catalog.refresh()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(undefined)
    }
  }

  /** Writes the provider's model overrides in one go, keeping what else is set on each model. */
  const writeModels = (provider: string, change: Record<string, Record<string, unknown>>) => {
    const before = configured(provider)
    const next = { ...before }
    for (const [model, patch] of Object.entries(change)) next[model] = { ...before[model], ...patch }
    return save.run(["providers", provider, "models"], next)
  }

  const setProvider = (provider: string, on: boolean) =>
    run(provider, async () => {
      const current = disabledList()
      const next = on ? current.filter((item) => item !== provider) : [...new Set([...current, provider])]
      await save.run(["disabled_providers"], next.length ? next : undefined)
    })

  const setModel = (provider: string, model: string, on: boolean) =>
    run(provider, () => writeModels(provider, { [model]: { disabled: !on } }))

  const setAll = (provider: string, on: boolean) =>
    run(provider, () =>
      writeModels(
        provider,
        Object.fromEntries(visible(provider).map((model) => [model.id, { disabled: !on }])),
      ),
    )

  const fetchAll = (provider: string, baseURL: string) =>
    run(provider, async () => {
      const fetched = await remote.fetchModels({ baseURL, provider })
      const known = new Set([...(models().get(provider) ?? []).map((model) => model.id), ...Object.keys(configured(provider))])
      const added = fetched.filter((model) => !known.has(model.id))
      if (added.length)
        await writeModels(
          provider,
          Object.fromEntries(added.map((model) => [model.id, { name: model.name ?? model.id, disabled: false }])),
        )
      setNote(ctx.t("catalog.fetched", { count: fetched.length, added: added.length }))
    })

  const baseURL = (settings: unknown) => (isPlainObject(settings) ? text(settings.baseURL) : "")

  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h3 class="settings-section-title">{ctx.t("catalog.title")}</h3>
        <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("catalog.description")}</p>
      </div>

      <Show
        when={catalog.query.data}
        fallback={
          <p class="text-12-regular text-v2-text-text-muted">
            {catalog.query.isError ? errorMessage(catalog.query.error) : ctx.t("config.loading")}
          </p>
        }
      >
        <ErrorText message={error() ?? save.error()} />
        <div data-component="settings-list">
          <For each={providers()}>
            {(provider) => {
              const list = () => models().get(provider.id) ?? []
              const hidden = () => list().filter((model) => !shown(provider.id, model)).length
              const on = () => !disabledList().includes(provider.id)
              const url = () => baseURL(provider.settings)

              return (
                <div class="flex flex-col gap-2 py-1">
                  <div data-component="settings-row">
                    <div data-slot="settings-row-copy">
                      <div data-slot="settings-row-title">{provider.name}</div>
                      <div data-slot="settings-row-description">
                        {[
                          provider.id,
                          ctx.t("catalog.count", { total: list().length, hidden: hidden() }),
                          ...(url() ? [url()] : []),
                        ].join(" · ")}
                      </div>
                    </div>
                    <div data-slot="settings-row-control" class="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setFilter("")
                          setNote(undefined)
                          setOpen(open() === provider.id ? undefined : provider.id)
                        }}
                      >
                        {open() === provider.id ? ctx.t("close") : ctx.t("catalog.models")}
                      </Button>
                      <Switch
                        hideLabel
                        checked={on()}
                        disabled={busy() === provider.id}
                        onChange={(checked) => void setProvider(provider.id, checked)}
                      >
                        {provider.name}
                      </Switch>
                    </div>
                  </div>

                  <Show when={open() === provider.id}>
                    <div class="flex flex-col gap-2 pl-2">
                      <div class="flex flex-wrap items-center gap-2">
                        <TextInput
                          class="min-w-48 flex-1"
                          value={filter()}
                          placeholder={ctx.t("providers.models.filter")}
                          onInput={(event) => setFilter(event.currentTarget.value)}
                        />
                        <Button
                          variant="neutral"
                          disabled={busy() === provider.id}
                          onClick={() => void setAll(provider.id, true)}
                        >
                          {ctx.t("catalog.showAll")}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy() === provider.id}
                          onClick={() => void setAll(provider.id, false)}
                        >
                          {ctx.t("catalog.hideAll")}
                        </Button>
                        <Show when={url()}>
                          <Button
                            variant="neutral"
                            disabled={busy() === provider.id}
                            onClick={() => void fetchAll(provider.id, url())}
                          >
                            {busy() === provider.id ? ctx.t("providers.fetching") : ctx.t("catalog.fetch")}
                          </Button>
                        </Show>
                      </div>
                      <Show when={note()}>
                        <p class="text-11-regular text-v2-text-text-muted">{note()}</p>
                      </Show>
                      <Show
                        when={list().length}
                        fallback={<p class="text-12-regular text-v2-text-text-muted">{ctx.t("catalog.none")}</p>}
                      >
                        <div class="flex max-h-72 flex-col overflow-y-auto rounded-md border border-v2-border-border-base py-1">
                          <For each={visible(provider.id)}>
                            {(model) => (
                              <label class="flex cursor-pointer items-center gap-2 px-3 py-1 text-12-regular text-v2-text-text-base">
                                <input
                                  type="checkbox"
                                  checked={shown(provider.id, model)}
                                  disabled={busy() === provider.id}
                                  onChange={(event) => void setModel(provider.id, model.id, event.currentTarget.checked)}
                                />
                                <span class="truncate">{model.id}</span>
                                <Show when={model.name && model.name !== model.id}>
                                  <span class="truncate text-v2-text-text-muted">{model.name}</span>
                                </Show>
                                <Show when={!model.enabled}>
                                  <span class="text-11-regular text-v2-text-text-muted">{ctx.t("catalog.hidden")}</span>
                                </Show>
                                <Show when={model.status !== "active"}>
                                  <span class="text-11-regular text-v2-text-text-muted">{model.status}</span>
                                </Show>
                              </label>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
