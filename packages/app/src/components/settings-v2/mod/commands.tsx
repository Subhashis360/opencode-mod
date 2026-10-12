import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "../parts/list"
import { compact, ENTRY_NAME } from "./entries"
import { DeleteButton, ModelSelect, ModField, ModTabHeader, revealEditor, Unavailable, useModConfig } from "./shared"
import { COMMAND_TEMPLATES, type CommandTemplate } from "./templates"

type CommandConfig = Record<string, unknown>
type Draft = { name: string; description: string; template: string; agent: string; model: string; subtask: boolean }
type Errors = Partial<Record<"name" | "template", string>>

// Built-in primary agents; custom ones come from the config.
const BUILT_IN_AGENTS = ["build", "plan"]
const MANAGED_KEYS = ["description", "template", "agent", "model", "subtask"]
const text = (value: unknown) => (typeof value === "string" ? value : "")

const emptyDraft = (): Draft => ({ name: "", description: "", template: "", agent: "", model: "", subtask: false })

function fromConfig(name: string, config: CommandConfig): Draft {
  return {
    name,
    description: text(config.description),
    template: text(config.template),
    agent: text(config.agent),
    model: text(config.model),
    subtask: config.subtask === true,
  }
}

function toConfig(draft: Draft, before: CommandConfig = {}): CommandConfig {
  const rest = Object.fromEntries(Object.entries(before).filter(([key]) => !MANAGED_KEYS.includes(key)))
  return compact({
    ...rest,
    description: draft.description.trim(),
    template: draft.template.trim(),
    agent: draft.agent,
    model: draft.model,
    subtask: draft.subtask || undefined,
  })
}

export function SettingsCommandsV2() {
  const language = useLanguage()
  const mod = useModConfig()
  const commands = createMemo(() =>
    Object.entries((mod.config().command ?? {}) as Record<string, CommandConfig>).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  )
  const agents = createMemo(() => ["", ...new Set([...BUILT_IN_AGENTS, ...Object.keys(mod.config().agent ?? {})])])
  const [editing, setEditing] = createSignal<{ original?: string }>()
  const [draft, setDraft] = createStore<Draft>(emptyDraft())
  const [errors, setErrors] = createStore<Errors>({})
  const [saving, setSaving] = createSignal(false)

  const open = (next: Draft, original?: string) => {
    setDraft(reconcile(next))
    setErrors(reconcile({}))
    // Remount the editor so it scrolls into view even when it was already open.
    setEditing(undefined)
    setEditing({ original })
  }

  const applyTemplate = (template: CommandTemplate) => {
    const taken = new Set(commands().map(([name]) => name))
    let name = template.name
    for (let i = 2; taken.has(name); i++) name = `${template.name}-${i}`
    open({
      ...emptyDraft(),
      name,
      description: template.description,
      template: template.template,
      subtask: !!template.subtask,
    })
  }

  const validate = (): Errors => {
    const next: Errors = {}
    const name = draft.name.trim()
    const original = editing()?.original
    if (!name) next.name = language.t("mod.error.required")
    else if (!ENTRY_NAME.test(name)) next.name = language.t("mod.error.name")
    else if (name !== original && commands().some(([existing]) => existing === name))
      next.name = language.t("mod.error.exists")
    if (!draft.template.trim()) next.template = language.t("mod.error.required")
    return next
  }

  const save = async () => {
    const next = validate()
    setErrors(reconcile(next))
    if (Object.keys(next).length) return
    const original = editing()?.original
    const before = original
      ? (mod.config().command as Record<string, CommandConfig> | undefined)?.[original]
      : undefined
    setSaving(true)
    const ok = await mod.saveEntry("command", draft.name.trim(), before, toConfig(draft, before))
    setSaving(false)
    if (ok) setEditing(undefined)
  }

  return (
    <>
      <ModTabHeader
        title={language.t("mod.commands.title")}
        description={language.t("mod.commands.description")}
        actions={
          <Show when={mod.available() && !editing()}>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => open(emptyDraft())}>
              {language.t("mod.commands.new")}
            </ButtonV2>
          </Show>
        }
      />
      <div class="settings-v2-tab-body">
        <Show when={mod.available()} fallback={<Unavailable />}>
          <Show when={editing()}>
            {(state) => (
              <form
                ref={revealEditor}
                class="mod-editor"
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
              >
                <h3 class="mod-editor-title">
                  {state().original ? `/${state().original}` : language.t("mod.commands.new")}
                </h3>
                <div class="mod-editor-grid">
                  <ModField
                    label={language.t("mod.field.name")}
                    hint={language.t("mod.field.name.hint")}
                    error={errors.name}
                  >
                    <TextInputV2
                      value={draft.name}
                      disabled={!!state().original}
                      invalid={!!errors.name}
                      onInput={(event) => setDraft("name", event.currentTarget.value)}
                    />
                  </ModField>
                  <ModField label={language.t("mod.field.description")}>
                    <TextInputV2
                      value={draft.description}
                      onInput={(event) => setDraft("description", event.currentTarget.value)}
                    />
                  </ModField>
                </div>
                <ModField
                  label={language.t("mod.commands.field.template")}
                  hint={language.t("mod.commands.field.template.hint")}
                  error={errors.template}
                >
                  <TextareaV2
                    rows={6}
                    value={draft.template}
                    invalid={!!errors.template}
                    onInput={(event) => setDraft("template", event.currentTarget.value)}
                  />
                </ModField>
                <div class="mod-editor-grid">
                  <ModField label={language.t("mod.commands.field.agent")}>
                    <SelectV2
                      appearance="base"
                      options={agents()}
                      current={draft.agent}
                      gutter={6}
                      value={(agent) => agent || "default"}
                      label={(agent) => agent || language.t("mod.commands.agent.default")}
                      onSelect={(agent) => agent !== null && setDraft("agent", agent)}
                    />
                  </ModField>
                  <ModField label={language.t("mod.field.model")}>
                    <ModelSelect value={draft.model} onChange={(model) => setDraft("model", model)} />
                  </ModField>
                </div>
                <ModField
                  label={language.t("mod.commands.field.subtask")}
                  hint={language.t("mod.commands.field.subtask.hint")}
                >
                  <Switch
                    hideLabel
                    checked={draft.subtask}
                    onChange={(subtask: boolean) => setDraft("subtask", subtask)}
                  >
                    {language.t("mod.commands.field.subtask")}
                  </Switch>
                </ModField>
                <div class="mod-editor-actions">
                  <ButtonV2 type="button" size="normal" variant="ghost" onClick={() => setEditing(undefined)}>
                    {language.t("common.cancel")}
                  </ButtonV2>
                  <ButtonV2 type="submit" size="normal" variant="contrast" disabled={saving()}>
                    {saving() ? language.t("common.saving") : language.t("common.save")}
                  </ButtonV2>
                </div>
              </form>
            )}
          </Show>

          <div class="settings-v2-section">
            <SettingsListV2>
              <Show
                when={commands().length > 0}
                fallback={<div class="settings-v2-provider-empty">{language.t("mod.commands.empty")}</div>}
              >
                <For each={commands()}>
                  {([name, config]) => (
                    <div class="settings-v2-provider-row">
                      <div class="settings-v2-provider-lead">
                        <div class="settings-v2-provider-copy">
                          <div class="settings-v2-provider-main">
                            <span class="settings-v2-provider-name">/{name}</span>
                            <Show when={text(config.agent)}>{(agent) => <Tag>{agent()}</Tag>}</Show>
                          </div>
                          <Show when={text(config.description)}>
                            {(description) => <p class="settings-v2-provider-description">{description()}</p>}
                          </Show>
                        </div>
                      </div>
                      <div class="settings-v2-provider-actions">
                        <ButtonV2
                          size="normal"
                          variant="ghost-muted"
                          onClick={() => open(fromConfig(name, config), name)}
                        >
                          {language.t("common.edit")}
                        </ButtonV2>
                        <DeleteButton onConfirm={() => void mod.deleteEntry("command", name)} />
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("mod.templates")}</h3>
            <div class="mod-templates">
              <For each={COMMAND_TEMPLATES}>
                {(template) => (
                  <button type="button" class="mod-template" onClick={() => applyTemplate(template)}>
                    <span class="mod-template-title">/{template.name}</span>
                    <span class="mod-template-description">{template.description}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </>
  )
}
