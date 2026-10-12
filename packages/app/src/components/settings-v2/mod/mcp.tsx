import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createMemo, createSignal, For, Match, Show, Switch as SwitchCase } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "../parts/list"
import { compact, ENTRY_NAME, formatPairs, joinCommandLine, parsePairs, splitCommandLine } from "./entries"
import { DeleteButton, ModField, ModTabHeader, revealEditor, Unavailable, useModConfig } from "./shared"
import { MCP_TEMPLATES, type McpTemplate } from "./templates"

type McpType = "local" | "remote"
type McpConfig = Record<string, unknown>
type Draft = {
  name: string
  type: McpType
  command: string
  cwd: string
  environment: string
  url: string
  headers: string
  timeout: string
  enabled: boolean
}
type Errors = Partial<Record<"name" | "command" | "environment" | "url" | "headers" | "timeout", string>>

const MANAGED_KEYS = ["type", "command", "cwd", "environment", "url", "headers", "timeout", "enabled"]
const text = (value: unknown) => (typeof value === "string" ? value : "")
const strings = (value: unknown) =>
  typeof value === "object" && value !== null ? (value as Record<string, string>) : undefined

const emptyDraft = (): Draft => ({
  name: "",
  type: "local",
  command: "",
  cwd: "",
  environment: "",
  url: "",
  headers: "",
  timeout: "",
  enabled: true,
})

function fromConfig(name: string, config: McpConfig): Draft {
  return {
    name,
    type: config.type === "remote" ? "remote" : "local",
    command: Array.isArray(config.command) ? joinCommandLine(config.command.map(String)) : "",
    cwd: text(config.cwd),
    environment: formatPairs(strings(config.environment), "="),
    url: text(config.url),
    headers: formatPairs(strings(config.headers), ":"),
    timeout: typeof config.timeout === "number" ? String(config.timeout) : "",
    enabled: config.enabled !== false,
  }
}

function fromTemplate(template: McpTemplate, name: string): Draft {
  if (template.type === "local")
    return {
      ...emptyDraft(),
      name,
      command: joinCommandLine(template.command),
      environment: formatPairs(template.environment, "="),
    }
  return { ...emptyDraft(), name, type: "remote", url: template.url, headers: formatPairs(template.headers, ":") }
}

// Keys the form does not manage (such as a remote server's oauth settings) are carried over.
function toConfig(draft: Draft, before: McpConfig = {}): McpConfig {
  const rest = Object.fromEntries(
    Object.entries(before).filter(
      ([key]) => !MANAGED_KEYS.includes(key) && (draft.type === "remote" || key !== "oauth"),
    ),
  )
  const timeout = draft.timeout.trim() ? Number(draft.timeout) : undefined
  if (draft.type === "local")
    return compact({
      ...rest,
      type: "local",
      command: splitCommandLine(draft.command),
      cwd: draft.cwd.trim(),
      environment: parsePairs(draft.environment, "=").pairs,
      timeout,
      enabled: draft.enabled,
    })
  return compact({
    ...rest,
    type: "remote",
    url: draft.url.trim(),
    headers: parsePairs(draft.headers, ":").pairs,
    timeout,
    enabled: draft.enabled,
  })
}

export function SettingsMcpV2() {
  const language = useLanguage()
  const mod = useModConfig()
  const servers = createMemo(() =>
    Object.entries((mod.config().mcp ?? {}) as Record<string, McpConfig>).sort(([a], [b]) => a.localeCompare(b)),
  )
  const [editing, setEditing] = createSignal<{ original?: string }>()
  const [draft, setDraft] = createStore<Draft>(emptyDraft())
  const [errors, setErrors] = createStore<Errors>({})
  const [saving, setSaving] = createSignal(false)

  const typeLabel = (type: McpType) => language.t(type === "remote" ? "mod.mcp.type.remote" : "mod.mcp.type.local")

  const open = (next: Draft, original?: string) => {
    setDraft(reconcile(next))
    setErrors(reconcile({}))
    // Remount the editor so it scrolls into view even when it was already open.
    setEditing(undefined)
    setEditing({ original })
  }

  const applyTemplate = (template: McpTemplate) => {
    const taken = new Set(servers().map(([name]) => name))
    let name = template.name
    for (let i = 2; taken.has(name); i++) name = `${template.name}-${i}`
    open(fromTemplate(template, name))
  }

  const lineError = (value: string, separator: "=" | ":") => {
    const line = parsePairs(value, separator).invalidLine
    return line === undefined ? undefined : language.t("mod.error.line", { line })
  }

  const validate = (): Errors => {
    const next: Errors = {}
    const name = draft.name.trim()
    const original = editing()?.original
    if (!name) next.name = language.t("mod.error.required")
    else if (!ENTRY_NAME.test(name)) next.name = language.t("mod.error.name")
    else if (name !== original && servers().some(([existing]) => existing === name))
      next.name = language.t("mod.error.exists")
    if (draft.type === "local") {
      if (splitCommandLine(draft.command).length === 0) next.command = language.t("mod.error.required")
      const environment = lineError(draft.environment, "=")
      if (environment) next.environment = environment
    } else {
      if (!/^https?:\/\/\S+$/.test(draft.url.trim())) next.url = language.t("mod.mcp.error.url")
      const headers = lineError(draft.headers, ":")
      if (headers) next.headers = headers
    }
    const timeout = Number(draft.timeout)
    if (draft.timeout.trim() && !(Number.isInteger(timeout) && timeout > 0))
      next.timeout = language.t("mod.error.integer")
    return next
  }

  const save = async () => {
    const next = validate()
    setErrors(reconcile(next))
    if (Object.keys(next).length) return
    const original = editing()?.original
    const before = original ? (mod.config().mcp as Record<string, McpConfig> | undefined)?.[original] : undefined
    setSaving(true)
    const ok = await mod.saveEntry("mcp", draft.name.trim(), before, toConfig(draft, before))
    setSaving(false)
    if (ok) setEditing(undefined)
  }

  // The schema needs the whole entry (type plus command or url), so a toggle resends it.
  const setEnabled = (name: string, config: McpConfig, enabled: boolean) =>
    mod.run(
      () => mod.update({ mcp: { [name]: { ...config, enabled } } } as Parameters<typeof mod.update>[0]),
      language.t("mod.toast.saved", { name }),
    )

  return (
    <>
      <ModTabHeader
        title={language.t("mod.mcp.title")}
        description={language.t("mod.mcp.description")}
        actions={
          <Show when={mod.available() && !editing()}>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => open(emptyDraft())}>
              {language.t("mod.mcp.new")}
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
                <h3 class="mod-editor-title">{state().original ?? language.t("mod.mcp.new")}</h3>
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
                  <ModField label={language.t("mod.mcp.field.type")}>
                    <SelectV2
                      appearance="base"
                      options={["local", "remote"] as McpType[]}
                      current={draft.type}
                      gutter={6}
                      label={typeLabel}
                      onSelect={(type) => type && setDraft("type", type)}
                    />
                  </ModField>
                </div>
                <SwitchCase>
                  <Match when={draft.type === "local"}>
                    <ModField
                      label={language.t("mod.mcp.field.command")}
                      hint={language.t("mod.mcp.field.command.hint")}
                      error={errors.command}
                    >
                      <TextInputV2
                        value={draft.command}
                        invalid={!!errors.command}
                        onInput={(event) => setDraft("command", event.currentTarget.value)}
                      />
                    </ModField>
                    <ModField label={language.t("mod.mcp.field.cwd")} hint={language.t("mod.mcp.field.cwd.hint")}>
                      <TextInputV2 value={draft.cwd} onInput={(event) => setDraft("cwd", event.currentTarget.value)} />
                    </ModField>
                    <ModField
                      label={language.t("mod.mcp.field.environment")}
                      hint={language.t("mod.mcp.field.environment.hint")}
                      error={errors.environment}
                    >
                      <TextareaV2
                        rows={3}
                        value={draft.environment}
                        invalid={!!errors.environment}
                        onInput={(event) => setDraft("environment", event.currentTarget.value)}
                      />
                    </ModField>
                  </Match>
                  <Match when={draft.type === "remote"}>
                    <ModField label={language.t("mod.mcp.field.url")} error={errors.url}>
                      <TextInputV2
                        value={draft.url}
                        invalid={!!errors.url}
                        placeholder="https://"
                        onInput={(event) => setDraft("url", event.currentTarget.value)}
                      />
                    </ModField>
                    <ModField
                      label={language.t("mod.mcp.field.headers")}
                      hint={language.t("mod.mcp.field.headers.hint")}
                      error={errors.headers}
                    >
                      <TextareaV2
                        rows={3}
                        value={draft.headers}
                        invalid={!!errors.headers}
                        onInput={(event) => setDraft("headers", event.currentTarget.value)}
                      />
                    </ModField>
                  </Match>
                </SwitchCase>
                <div class="mod-editor-grid">
                  <ModField
                    label={language.t("mod.mcp.field.timeout")}
                    hint={language.t("mod.mcp.field.timeout.hint")}
                    error={errors.timeout}
                  >
                    <TextInputV2
                      numeric
                      inputMode="numeric"
                      value={draft.timeout}
                      invalid={!!errors.timeout}
                      onInput={(event) => setDraft("timeout", event.currentTarget.value)}
                    />
                  </ModField>
                  <ModField label={language.t("mod.agents.enabled")}>
                    <Switch
                      hideLabel
                      checked={draft.enabled}
                      onChange={(enabled: boolean) => setDraft("enabled", enabled)}
                    >
                      {language.t("mod.agents.enabled")}
                    </Switch>
                  </ModField>
                </div>
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
                when={servers().length > 0}
                fallback={<div class="settings-v2-provider-empty">{language.t("mod.mcp.empty")}</div>}
              >
                <For each={servers()}>
                  {([name, config]) => (
                    <div class="settings-v2-provider-row">
                      <div class="settings-v2-provider-lead">
                        <div class="settings-v2-provider-copy">
                          <div class="settings-v2-provider-main">
                            <span class="settings-v2-provider-name">{name}</span>
                            <Tag>{typeLabel(config.type === "remote" ? "remote" : "local")}</Tag>
                            <Show when={config.enabled === false}>
                              <Tag>{language.t("mod.tag.disabled")}</Tag>
                            </Show>
                          </div>
                          <span class="mod-entry-meta">
                            {Array.isArray(config.command)
                              ? joinCommandLine(config.command.map(String))
                              : text(config.url)}
                          </span>
                        </div>
                      </div>
                      <div class="settings-v2-provider-actions">
                        <Switch
                          hideLabel
                          checked={config.enabled !== false}
                          onChange={(enabled: boolean) => void setEnabled(name, config, enabled)}
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
                        <DeleteButton onConfirm={() => void mod.deleteEntry("mcp", name)} />
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
              <For each={MCP_TEMPLATES}>
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
