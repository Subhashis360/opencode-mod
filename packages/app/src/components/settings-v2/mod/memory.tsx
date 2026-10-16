// OpenCode Mod: auto memory. Facts the agent saved about the user and each project; every session
// starts with the relevant ones in its system prompt.
import type { ModMemoryEntry } from "@opencode-ai/sdk/v2/client"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "../parts/list"
import { SettingsRowV2 } from "../parts/row"
import { DeleteButton, ModField, ModTabHeader, revealEditor } from "./shared"

type Draft = { id?: string; text: string; scope: ModMemoryEntry["scope"]; project: string }

export function SettingsMemoryV2() {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])
  const api = () => serverSdk().client.global.mod
  const [data, { refetch }] = createResource(
    async () => (await api().memory()).data ?? { enabled: true, entries: [] },
    {
      initialValue: { enabled: true, entries: [] },
    },
  )
  const [filter, setFilter] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createStore<Draft>({ text: "", scope: "global", project: "" })
  const entries = createMemo(() => {
    const query = filter().trim().toLowerCase()
    return data()
      .entries.filter(
        (entry) => !query || entry.text.toLowerCase().includes(query) || entry.project?.toLowerCase().includes(query),
      )
      .toSorted((a, b) => b.updated - a.updated)
  })
  const folder = (dir?: string) => dir?.split(/[\\/]/).filter(Boolean).at(-1) ?? ""

  const open = (next: Draft) => {
    setDraft(reconcile(next))
    setEditing(false)
    setEditing(true)
  }

  const save = async () => {
    const result = (
      await api().memorySave({
        id: draft.id,
        text: draft.text,
        scope: draft.scope,
        project: draft.project || undefined,
      })
    ).data
    if (!result?.success) {
      showToast({ title: t("common.requestFailed"), description: result && !result.success ? result.error : undefined })
      return
    }
    setEditing(false)
    void refetch()
  }

  return (
    <>
      <ModTabHeader
        title={t("mod.memory.title")}
        description={t("mod.memory.description")}
        actions={
          <Show when={!editing()}>
            <ButtonV2
              size="normal"
              variant="neutral"
              icon="plus"
              onClick={() => open({ text: "", scope: "global", project: "" })}
            >
              {t("mod.memory.new")}
            </ButtonV2>
          </Show>
        }
      />
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2 title={t("mod.memory.enabled")} description={t("mod.memory.enabled.hint")}>
              <Switch
                checked={data().enabled}
                onChange={(enabled: boolean) =>
                  void api()
                    .memoryEnabled({ enabled })
                    .then(() => refetch())
                }
              />
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <Show when={editing()}>
          <form
            ref={revealEditor}
            class="mod-editor"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <ModField label={t("mod.memory.field.text")} hint={t("mod.memory.field.text.hint")}>
              <TextareaV2
                rows={3}
                value={draft.text}
                onInput={(event) => setDraft("text", event.currentTarget.value)}
              />
            </ModField>
            <div class="mod-editor-grid">
              <ModField label={t("mod.memory.field.scope")}>
                <SelectV2
                  appearance="base"
                  options={["global", "project"] as const}
                  current={draft.scope}
                  gutter={6}
                  label={(scope) => t(`mod.memory.scope.${scope}`)}
                  onSelect={(scope) => scope && setDraft("scope", scope)}
                />
              </ModField>
              <Show when={draft.scope === "project"}>
                <ModField label={t("mod.schedule.field.directory")}>
                  <TextInputV2
                    value={draft.project}
                    onInput={(event) => setDraft("project", event.currentTarget.value)}
                  />
                </ModField>
              </Show>
            </div>
            <div class="mod-editor-actions">
              <ButtonV2 type="button" size="normal" variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </ButtonV2>
              <ButtonV2 type="submit" size="normal" variant="contrast">
                {t("common.save")}
              </ButtonV2>
            </div>
          </form>
        </Show>

        <div class="settings-v2-section">
          <TextInputV2
            placeholder={t("mod.memory.search")}
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
          <SettingsListV2>
            <Show
              when={entries().length > 0}
              fallback={<div class="settings-v2-provider-empty">{t("mod.memory.empty")}</div>}
            >
              <For each={entries()}>
                {(entry) => (
                  <div class="settings-v2-provider-row">
                    <div class="settings-v2-provider-lead">
                      <div class="settings-v2-provider-copy">
                        <div class="settings-v2-provider-main">
                          <Tag>{entry.scope === "global" ? t("mod.memory.scope.global") : folder(entry.project)}</Tag>
                          <span class="mod-field-hint">{new Date(entry.updated).toLocaleDateString()}</span>
                        </div>
                        <p class="settings-v2-provider-description">{entry.text}</p>
                      </div>
                    </div>
                    <div class="settings-v2-provider-actions">
                      <ButtonV2
                        size="normal"
                        variant="ghost-muted"
                        onClick={() =>
                          open({ id: entry.id, text: entry.text, scope: entry.scope, project: entry.project ?? "" })
                        }
                      >
                        {t("common.edit")}
                      </ButtonV2>
                      <DeleteButton
                        onConfirm={() =>
                          void api()
                            .memoryRemove({ id: entry.id })
                            .then(() => refetch())
                        }
                      />
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
