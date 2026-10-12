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
import { compact, ENTRY_NAME, isAction, isPlainObject, type PermissionAction } from "./entries"
import {
  ActionSelect,
  DeleteButton,
  ModelSelect,
  ModField,
  ModTabHeader,
  revealEditor,
  Unavailable,
  useModConfig,
} from "./shared"
import { AGENT_TEMPLATES, type AgentTemplate } from "./templates"

type Mode = "primary" | "subagent" | "all"
const MODES: Mode[] = ["primary", "subagent", "all"]
const LIMITED_TOOLS = ["edit", "bash", "webfetch"] as const
type LimitedTool = (typeof LIMITED_TOOLS)[number]
type Limit = PermissionAction | "default" | "custom"
type AgentConfig = Record<string, unknown>

type Draft = {
  name: string
  description: string
  mode: Mode
  model: string
  temperature: string
  steps: string
  color: string
  prompt: string
  limits: Record<LimitedTool, Limit>
}
type Errors = Partial<Record<"name" | "temperature" | "steps" | "color", string>>

const THEME_COLORS = ["primary", "secondary", "accent", "success", "warning", "error", "info"]

const text = (value: unknown) => (typeof value === "string" ? value : "")

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  mode: "all",
  model: "",
  temperature: "",
  steps: "",
  color: "",
  prompt: "",
  limits: { edit: "default", bash: "default", webfetch: "default" },
})

function fromConfig(name: string, config: AgentConfig): Draft {
  const permission = isPlainObject(config.permission) ? config.permission : {}
  const limit = (tool: LimitedTool): Limit => {
    const value = permission[tool]
    if (value === undefined) return "default"
    return isAction(value) ? value : "custom"
  }
  return {
    name,
    description: text(config.description),
    mode: config.mode === "primary" || config.mode === "subagent" ? config.mode : "all",
    model: text(config.model),
    temperature: typeof config.temperature === "number" ? String(config.temperature) : "",
    steps: typeof config.steps === "number" ? String(config.steps) : "",
    color: text(config.color),
    prompt: text(config.prompt),
    limits: { edit: limit("edit"), bash: limit("bash"), webfetch: limit("webfetch") },
  }
}

// Fields the form does not show (options, top_p, variant, disable, other permissions...) are
// carried over from the stored entry so editing never drops them.
function toConfig(draft: Draft, before: AgentConfig = {}): AgentConfig {
  const {
    description: _description,
    mode: _mode,
    model: _model,
    temperature: _temperature,
    steps: _steps,
    maxSteps: _maxSteps,
    color: _color,
    prompt: _prompt,
    permission,
    ...rest
  } = before
  const nextPermission: Record<string, unknown> = { ...(isPlainObject(permission) ? permission : {}) }
  for (const tool of LIMITED_TOOLS) {
    const limit = draft.limits[tool]
    if (limit === "custom") continue
    if (limit === "default") delete nextPermission[tool]
    else nextPermission[tool] = limit
  }
  return compact({
    ...rest,
    description: draft.description.trim(),
    mode: draft.mode,
    model: draft.model,
    temperature: draft.temperature.trim() ? Number(draft.temperature) : undefined,
    steps: draft.steps.trim() ? Number(draft.steps) : undefined,
    color: draft.color.trim(),
    prompt: draft.prompt.trim(),
    permission: nextPermission,
  })
}

function fromTemplate(template: AgentTemplate, name: string): Draft {
  return {
    ...emptyDraft(),
    name,
    description: template.description,
    mode: template.mode,
    temperature: template.temperature === undefined ? "" : String(template.temperature),
    prompt: template.prompt,
    limits: {
      edit: template.permission?.edit ?? "default",
      bash: template.permission?.bash ?? "default",
      webfetch: template.permission?.webfetch ?? "default",
    },
  }
}

export function SettingsAgentsV2() {
  const language = useLanguage()
  const mod = useModConfig()
  const agents = createMemo(() =>
    Object.entries((mod.config().agent ?? {}) as Record<string, AgentConfig>).sort(([a], [b]) => a.localeCompare(b)),
  )
  const [editing, setEditing] = createSignal<{ original?: string }>()
  const [draft, setDraft] = createStore<Draft>(emptyDraft())
  const [errors, setErrors] = createStore<Errors>({})
  const [saving, setSaving] = createSignal(false)

  const modeLabel = (mode: unknown) =>
    language.t(mode === "primary" || mode === "subagent" ? `mod.agents.mode.${mode}` : "mod.agents.mode.all")

  const open = (next: Draft, original?: string) => {
    setDraft(reconcile(next))
    setErrors(reconcile({}))
    // Remount the editor so it scrolls into view even when it was already open.
    setEditing(undefined)
    setEditing({ original })
  }

  const applyTemplate = (template: AgentTemplate) => {
    const taken = new Set(agents().map(([name]) => name))
    let name = template.name
    for (let i = 2; taken.has(name); i++) name = `${template.name}-${i}`
    open(fromTemplate(template, name))
  }

  const validate = (): Errors => {
    const next: Errors = {}
    const name = draft.name.trim()
    const original = editing()?.original
    if (!name) next.name = language.t("mod.error.required")
    else if (!ENTRY_NAME.test(name)) next.name = language.t("mod.error.name")
    else if (name !== original && agents().some(([existing]) => existing === name))
      next.name = language.t("mod.error.exists")
    const temperature = Number(draft.temperature)
    if (draft.temperature.trim() && !(temperature >= 0 && temperature <= 2))
      next.temperature = language.t("mod.error.number", { min: 0, max: 2 })
    const steps = Number(draft.steps)
    if (draft.steps.trim() && !(Number.isInteger(steps) && steps > 0)) next.steps = language.t("mod.error.integer")
    const color = draft.color.trim()
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color) && !THEME_COLORS.includes(color))
      next.color = language.t("mod.error.color")
    return next
  }

  const save = async () => {
    const next = validate()
    setErrors(reconcile(next))
    if (Object.keys(next).length) return
    const original = editing()?.original
    const before = original ? (mod.config().agent as Record<string, AgentConfig> | undefined)?.[original] : undefined
    setSaving(true)
    const ok = await mod.saveEntry("agent", draft.name.trim(), before, toConfig(draft, before))
    setSaving(false)
    if (ok) setEditing(undefined)
  }

  const setEnabled = (name: string, enabled: boolean) =>
    mod.run(
      () => (enabled ? mod.remove(["agent", name, "disable"]) : mod.update({ agent: { [name]: { disable: true } } })),
      language.t("mod.toast.saved", { name }),
    )

  return (
    <>
      <ModTabHeader
        title={language.t("mod.agents.title")}
        description={language.t("mod.agents.description")}
        actions={
          <Show when={mod.available() && !editing()}>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => open(emptyDraft())}>
              {language.t("mod.agents.new")}
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
                  {state().original
                    ? language.t("mod.agents.editing", { name: state().original! })
                    : language.t("mod.agents.new")}
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
                  <ModField label={language.t("mod.agents.field.mode")}>
                    <SelectV2
                      appearance="base"
                      options={MODES}
                      current={draft.mode}
                      gutter={6}
                      label={modeLabel}
                      onSelect={(mode) => mode && setDraft("mode", mode)}
                    />
                  </ModField>
                </div>
                <ModField label={language.t("mod.field.description")}>
                  <TextInputV2
                    value={draft.description}
                    onInput={(event) => setDraft("description", event.currentTarget.value)}
                  />
                </ModField>
                <ModField label={language.t("mod.field.model")}>
                  <ModelSelect value={draft.model} onChange={(model) => setDraft("model", model)} />
                </ModField>
                <ModField
                  label={language.t("mod.agents.field.prompt")}
                  hint={language.t("mod.agents.field.prompt.hint")}
                >
                  <TextareaV2
                    rows={8}
                    value={draft.prompt}
                    onInput={(event) => setDraft("prompt", event.currentTarget.value)}
                  />
                </ModField>
                <div class="mod-editor-grid">
                  <ModField
                    label={language.t("mod.agents.field.temperature")}
                    hint={language.t("mod.agents.field.temperature.hint")}
                    error={errors.temperature}
                  >
                    <TextInputV2
                      numeric
                      inputMode="decimal"
                      value={draft.temperature}
                      invalid={!!errors.temperature}
                      onInput={(event) => setDraft("temperature", event.currentTarget.value)}
                    />
                  </ModField>
                  <ModField
                    label={language.t("mod.agents.field.steps")}
                    hint={language.t("mod.agents.field.steps.hint")}
                    error={errors.steps}
                  >
                    <TextInputV2
                      numeric
                      inputMode="numeric"
                      value={draft.steps}
                      invalid={!!errors.steps}
                      onInput={(event) => setDraft("steps", event.currentTarget.value)}
                    />
                  </ModField>
                </div>
                <ModField label={language.t("mod.agents.field.color")} error={errors.color}>
                  <TextInputV2
                    placeholder="#FF5733"
                    value={draft.color}
                    invalid={!!errors.color}
                    onInput={(event) => setDraft("color", event.currentTarget.value)}
                  />
                </ModField>
                <ModField label={language.t("mod.agents.field.tools")} hint={language.t("mod.agents.field.tools.hint")}>
                  <div class="mod-tool-limits">
                    <For each={LIMITED_TOOLS}>
                      {(tool) => (
                        <div class="mod-tool-limit">
                          <span>{language.t(`mod.agents.tool.${tool}`)}</span>
                          <ActionSelect
                            value={draft.limits[tool]}
                            onChange={(value) => setDraft("limits", tool, value)}
                          />
                        </div>
                      )}
                    </For>
                  </div>
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
                when={agents().length > 0}
                fallback={<div class="settings-v2-provider-empty">{language.t("mod.agents.empty")}</div>}
              >
                <For each={agents()}>
                  {([name, config]) => (
                    <div class="settings-v2-provider-row">
                      <div class="settings-v2-provider-lead">
                        <div class="settings-v2-provider-copy">
                          <div class="settings-v2-provider-main">
                            <span class="settings-v2-provider-name">{name}</span>
                            <Tag>{modeLabel(config.mode)}</Tag>
                            <Show when={config.disable === true}>
                              <Tag>{language.t("mod.tag.disabled")}</Tag>
                            </Show>
                          </div>
                          <Show when={text(config.description)}>
                            {(description) => <p class="settings-v2-provider-description">{description()}</p>}
                          </Show>
                        </div>
                      </div>
                      <div class="settings-v2-provider-actions">
                        <Switch
                          hideLabel
                          checked={config.disable !== true}
                          onChange={(enabled: boolean) => void setEnabled(name, enabled)}
                        >
                          {language.t("mod.agents.enabled")}
                        </Switch>
                        <ButtonV2
                          size="normal"
                          variant="ghost-muted"
                          onClick={() => open(fromConfig(name, config), name)}
                        >
                          {language.t("common.edit")}
                        </ButtonV2>
                        <DeleteButton onConfirm={() => void mod.deleteEntry("agent", name)} />
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
              <For each={AGENT_TEMPLATES}>
                {(template) => (
                  <button type="button" class="mod-template" onClick={() => applyTemplate(template)}>
                    <span class="mod-template-title">{template.title}</span>
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
