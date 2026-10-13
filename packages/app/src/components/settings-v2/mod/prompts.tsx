import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "../parts/list"
import { DeleteButton, ModField, ModTabHeader, revealEditor, Unavailable, useModConfig } from "./shared"

type Saved = { id: string; name: string; content: string }
type Source = { id: string; label: string; content: string }
type AgentConfig = { prompt?: unknown; mode?: unknown }

// Saved prompts live in the desktop store next to the mod's other local settings.
const MOD_STORE = "opencode.mod"
const LIBRARY_KEY = "promptLibrary"

function parseLibrary(raw: unknown): Saved[] {
  if (typeof raw !== "string") return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is Saved =>
        !!item && typeof item.id === "string" && typeof item.name === "string" && typeof item.content === "string",
    )
  } catch {
    return []
  }
}

export function SettingsPromptsV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const mod = useModConfig()
  const client = () => serverSDK().client.global.mod

  const [builtIn] = createResource(
    () => mod.available() || undefined,
    async () => (await client().prompts()).data?.prompts ?? [],
  )
  const builtInList = () => (builtIn.error ? [] : (builtIn() ?? []))

  const [upstream, setUpstream] = createSignal<Record<string, string>>()
  const [checking, setChecking] = createSignal(false)
  const [githubFailed, setGithubFailed] = createSignal(false)
  const checkGithub = async () => {
    setChecking(true)
    setGithubFailed(false)
    const prompts = await client()
      .promptsUpstream()
      .then((response) => response.data?.prompts ?? {})
      .catch(() => ({}))
    setUpstream(prompts)
    setGithubFailed(Object.keys(prompts).length === 0)
    setChecking(false)
  }

  const storage = platform.storage?.(MOD_STORE)
  const [library, setLibrary] = createSignal<Saved[]>([])
  onMount(async () => {
    if (storage) setLibrary(parseLibrary(await Promise.resolve(storage.getItem(LIBRARY_KEY)).catch(() => null)))
  })
  const saveLibrary = (next: Saved[]) => {
    setLibrary(next)
    void Promise.resolve(storage?.setItem(LIBRARY_KEY, JSON.stringify(next)))
  }
  const addToLibrary = (name: string, content: string) => {
    saveLibrary([...library(), { id: crypto.randomUUID(), name: name.trim() || "Untitled", content }])
    showToast({ variant: "success", icon: "circle-check", title: language.t("mod.prompts.toast.savedToLibrary") })
  }

  // Build and plan always exist; custom agents that can be picked as the main agent are added.
  const agents = createMemo(() => {
    const config = (mod.config().agent ?? {}) as Record<string, AgentConfig>
    const names = new Set(["build", "plan"])
    for (const [name, agent] of Object.entries(config)) if (agent.mode !== "subagent") names.add(name)
    return [...names].map((name) => {
      const prompt = config[name]?.prompt
      return { name, prompt: typeof prompt === "string" && prompt.trim() ? prompt : undefined }
    })
  })

  const [editing, setEditing] = createSignal<string>()
  const [draft, setDraft] = createSignal("")
  const [libraryName, setLibraryName] = createSignal("")
  const [viewing, setViewing] = createSignal<string>()
  const [libraryEditing, setLibraryEditing] = createSignal<Saved>()

  const titleOf = (id: string) => builtInList().find((prompt) => prompt.id === id)?.title ?? id
  // Upstream adds, renames and removes prompts between versions; ones this version lacks are
  // listed on their own.
  const githubOnly = createMemo(() =>
    Object.entries(upstream() ?? {}).filter(([id]) => !builtInList().some((prompt) => prompt.id === id)),
  )

  const sources = createMemo<Source[]>(() => [
    ...builtInList().map((prompt) => ({
      id: `builtin:${prompt.id}`,
      label: language.t("mod.prompts.startFrom.builtIn", { title: prompt.title }),
      content: prompt.content,
    })),
    ...Object.entries(upstream() ?? {}).map(([id, content]) => ({
      id: `upstream:${id}`,
      label: language.t("mod.prompts.startFrom.upstream", { title: titleOf(id) }),
      content,
    })),
    ...library().map((saved) => ({
      id: `saved:${saved.id}`,
      label: language.t("mod.prompts.startFrom.saved", { name: saved.name }),
      content: saved.content,
    })),
  ])

  const openEditor = (name: string, current?: string) => {
    setDraft(current ?? "")
    setLibraryName("")
    setEditing(undefined)
    setEditing(name)
  }

  const save = (name: string) =>
    mod.run(
      async () => {
        if (draft().trim()) await mod.update({ agent: { [name]: { prompt: draft() } } })
        else await mod.remove(["agent", name, "prompt"])
        setEditing(undefined)
      },
      language.t("mod.toast.saved", { name }),
    )

  const reset = (name: string) =>
    mod.run(() => mod.remove(["agent", name, "prompt"]), language.t("mod.prompts.toast.reset", { name }))

  return (
    <>
      <ModTabHeader title={language.t("mod.prompts.title")} description={language.t("mod.prompts.description")} />
      <div class="settings-v2-tab-body">
        <Show when={mod.available()} fallback={<Unavailable />}>
          <Show when={editing()}>
            {(name) => (
              <form
                ref={revealEditor}
                class="mod-editor"
                onSubmit={(event) => {
                  event.preventDefault()
                  void save(name())
                }}
              >
                <h3 class="mod-editor-title">{language.t("mod.prompts.editing", { name: name() })}</h3>
                <ModField label={language.t("mod.prompts.startFrom")}>
                  <SelectV2
                    appearance="base"
                    options={sources()}
                    placeholder={language.t("mod.prompts.startFrom.placeholder")}
                    gutter={6}
                    value={(source) => source.id}
                    label={(source) => source.label}
                    onSelect={(source) => source && setDraft(source.content)}
                  />
                </ModField>
                <ModField label={language.t("mod.prompts.content")}>
                  <TextareaV2 rows={14} value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} />
                </ModField>
                <Show when={storage}>
                  <div class="mod-editor-grid">
                    <ModField label={language.t("mod.prompts.library.name")}>
                      <TextInputV2
                        value={libraryName()}
                        onInput={(event) => setLibraryName(event.currentTarget.value)}
                      />
                    </ModField>
                    <div class="mod-field mod-field-end">
                      <ButtonV2
                        type="button"
                        size="normal"
                        variant="ghost"
                        disabled={!draft().trim()}
                        onClick={() => addToLibrary(libraryName(), draft())}
                      >
                        {language.t("mod.prompts.saveToLibrary")}
                      </ButtonV2>
                    </div>
                  </div>
                </Show>
                <div class="mod-editor-actions">
                  <ButtonV2 type="button" size="normal" variant="ghost" onClick={() => setEditing(undefined)}>
                    {language.t("common.cancel")}
                  </ButtonV2>
                  <ButtonV2 type="submit" size="normal" variant="contrast">
                    {language.t("common.save")}
                  </ButtonV2>
                </div>
              </form>
            )}
          </Show>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("mod.prompts.agents")}</h3>
            <SettingsListV2>
              <For each={agents()}>
                {(agent) => (
                  <div class="settings-v2-provider-row">
                    <div class="settings-v2-provider-lead">
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name">{agent.name}</span>
                        <Tag variant={agent.prompt ? "accent" : "neutral"}>
                          {agent.prompt
                            ? language.t("mod.prompts.agent.custom")
                            : language.t("mod.prompts.agent.default")}
                        </Tag>
                      </div>
                    </div>
                    <div class="settings-v2-provider-actions">
                      <ButtonV2
                        size="normal"
                        variant="ghost-muted"
                        onClick={() => openEditor(agent.name, agent.prompt)}
                      >
                        {language.t("common.edit")}
                      </ButtonV2>
                      <Show when={agent.prompt}>
                        <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void reset(agent.name)}>
                          {language.t("mod.prompts.reset")}
                        </ButtonV2>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <div class="mod-section-header">
              <h3 class="settings-v2-section-title">{language.t("mod.prompts.builtIn")}</h3>
              <ButtonV2 size="normal" variant="neutral" disabled={checking()} onClick={() => void checkGithub()}>
                {checking() ? language.t("mod.prompts.checkingGithub") : language.t("mod.prompts.checkGithub")}
              </ButtonV2>
            </div>
            <Show when={githubFailed()}>
              <p class="mod-field-error">{language.t("mod.prompts.githubFailed")}</p>
            </Show>
            <SettingsListV2>
              <For each={builtInList()}>
                {(prompt) => {
                  const latest = () => upstream()?.[prompt.id]
                  return (
                    <div class="mod-prompt-row">
                      <div class="settings-v2-provider-row">
                        <div class="settings-v2-provider-lead">
                          <div class="settings-v2-provider-copy">
                            <div class="settings-v2-provider-main">
                              <span class="settings-v2-provider-name">{prompt.title}</span>
                              <Show when={latest()}>
                                {(content) => (
                                  <Tag variant={content() !== prompt.content ? "accent" : "neutral"}>
                                    {content() !== prompt.content
                                      ? language.t("mod.prompts.newer")
                                      : language.t("mod.prompts.same")}
                                  </Tag>
                                )}
                              </Show>
                            </div>
                            <p class="settings-v2-provider-description">
                              {language.t("mod.prompts.builtIn.usedBy", { models: prompt.usedBy })}
                            </p>
                          </div>
                        </div>
                        <div class="settings-v2-provider-actions">
                          <ButtonV2
                            size="normal"
                            variant="ghost-muted"
                            onClick={() => setViewing(viewing() === prompt.id ? undefined : prompt.id)}
                          >
                            {viewing() === prompt.id ? language.t("mod.prompts.hide") : language.t("mod.prompts.view")}
                          </ButtonV2>
                          <Show when={storage}>
                            <ButtonV2
                              size="normal"
                              variant="ghost-muted"
                              onClick={() => addToLibrary(prompt.title, latest() ?? prompt.content)}
                            >
                              {language.t("mod.prompts.library.copy")}
                            </ButtonV2>
                          </Show>
                        </div>
                      </div>
                      <Show when={viewing() === prompt.id}>
                        <TextareaV2 class="mod-prompt-view" rows={12} readOnly value={latest() ?? prompt.content} />
                      </Show>
                    </div>
                  )
                }}
              </For>
              <For each={githubOnly()}>
                {([id, content]) => (
                  <div class="mod-prompt-row">
                    <div class="settings-v2-provider-row">
                      <div class="settings-v2-provider-lead">
                        <div class="settings-v2-provider-main">
                          <span class="settings-v2-provider-name">{id}</span>
                          <Tag variant="accent">{language.t("mod.prompts.githubOnly")}</Tag>
                        </div>
                      </div>
                      <div class="settings-v2-provider-actions">
                        <ButtonV2
                          size="normal"
                          variant="ghost-muted"
                          onClick={() => setViewing(viewing() === `github:${id}` ? undefined : `github:${id}`)}
                        >
                          {viewing() === `github:${id}`
                            ? language.t("mod.prompts.hide")
                            : language.t("mod.prompts.view")}
                        </ButtonV2>
                        <Show when={storage}>
                          <ButtonV2 size="normal" variant="ghost-muted" onClick={() => addToLibrary(id, content)}>
                            {language.t("mod.prompts.library.copy")}
                          </ButtonV2>
                        </Show>
                      </div>
                    </div>
                    <Show when={viewing() === `github:${id}`}>
                      <TextareaV2 class="mod-prompt-view" rows={12} readOnly value={content} />
                    </Show>
                  </div>
                )}
              </For>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("mod.prompts.library")}</h3>
            <Show when={libraryEditing()}>
              {(saved) => (
                <form
                  ref={revealEditor}
                  class="mod-editor"
                  onSubmit={(event) => {
                    event.preventDefault()
                    saveLibrary(library().map((item) => (item.id === saved().id ? saved() : item)))
                    setLibraryEditing(undefined)
                  }}
                >
                  <ModField label={language.t("mod.prompts.library.name")}>
                    <TextInputV2
                      value={saved().name}
                      onInput={(event) => setLibraryEditing({ ...saved(), name: event.currentTarget.value })}
                    />
                  </ModField>
                  <ModField label={language.t("mod.prompts.content")}>
                    <TextareaV2
                      rows={12}
                      value={saved().content}
                      onInput={(event) => setLibraryEditing({ ...saved(), content: event.currentTarget.value })}
                    />
                  </ModField>
                  <div class="mod-editor-actions">
                    <ButtonV2 type="button" size="normal" variant="ghost" onClick={() => setLibraryEditing(undefined)}>
                      {language.t("common.cancel")}
                    </ButtonV2>
                    <ButtonV2 type="submit" size="normal" variant="contrast">
                      {language.t("common.save")}
                    </ButtonV2>
                  </div>
                </form>
              )}
            </Show>
            <SettingsListV2>
              <Show
                when={storage}
                fallback={<div class="settings-v2-provider-empty">{language.t("mod.prompts.library.desktopOnly")}</div>}
              >
                <Show
                  when={library().length > 0}
                  fallback={<div class="settings-v2-provider-empty">{language.t("mod.prompts.library.empty")}</div>}
                >
                  <For each={library()}>
                    {(saved) => (
                      <div class="settings-v2-provider-row">
                        <div class="settings-v2-provider-lead">
                          <span class="settings-v2-provider-name">{saved.name}</span>
                        </div>
                        <div class="settings-v2-provider-actions">
                          <ButtonV2 size="normal" variant="ghost-muted" onClick={() => setLibraryEditing({ ...saved })}>
                            {language.t("common.edit")}
                          </ButtonV2>
                          <DeleteButton
                            onConfirm={() => saveLibrary(library().filter((item) => item.id !== saved.id))}
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
