// OpenCode Mod: hooks, the user's own shell commands that run on agent events (like Claude Code).
import type { ModHook } from "@opencode-ai/sdk/v2/client"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createResource, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "../parts/list"
import { DeleteButton, ModField, ModTabHeader, revealEditor } from "./shared"

type Event = ModHook["event"]
const EVENTS: Event[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionIdle",
  "PermissionAsked",
  "SessionError",
]
type Draft = {
  id?: string
  name: string
  event: Event
  matcher: string
  command: string
  timeout: string
  enabled: boolean
}

const win = navigator.userAgent.includes("Windows")
const TEMPLATES: Omit<Draft, "timeout" | "enabled">[] = [
  {
    name: "Block destructive commands",
    event: "PreToolUse",
    matcher: "bash",
    command: win
      ? `$i = [Console]::In.ReadToEnd() | ConvertFrom-Json; if ($i.input.command -match 'rm -rf|Remove-Item .*-Recurse|git push --force|format ') { [Console]::Error.WriteLine('Destructive command blocked by hook'); exit 2 }`
      : `jq -r .input.command | grep -Eq 'rm -rf|git push --force' && { echo 'Destructive command blocked by hook' >&2; exit 2; } || exit 0`,
  },
  {
    name: "Notify when the agent finishes",
    event: "SessionIdle",
    matcher: "",
    command: win
      ? `[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]; $x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1); $x.GetElementsByTagName('text')[0].InnerText = 'OpenCode Mod: agent finished'; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenCode Mod').Show([Windows.UI.Notifications.ToastNotification]::new($x))`
      : `notify-send "OpenCode" "Agent finished" || osascript -e 'display notification "Agent finished" with title "OpenCode"'`,
  },
  {
    name: "Format files after edits",
    event: "PostToolUse",
    matcher: "edit|write|apply_patch",
    command: "npx --no-install prettier --write . --log-level warn",
  },
  {
    name: "Log every shell command",
    event: "PreToolUse",
    matcher: "bash",
    command: win
      ? `[Console]::In.ReadToEnd() | Add-Content "$env:USERPROFILE\\opencode-commands.log"`
      : `cat >> ~/opencode-commands.log; echo >> ~/opencode-commands.log`,
  },
]

const empty = (): Draft => ({ name: "", event: "PreToolUse", matcher: "", command: "", timeout: "30", enabled: true })

export function SettingsHooksV2() {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])
  const api = () => serverSdk().client.global.mod
  const [hooks, { refetch }] = createResource(async () => (await api().hooks()).data ?? [], { initialValue: [] })
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createStore<Draft>(empty())
  const [test, setTest] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)

  const write = async (next: ModHook[]) => {
    const result = (await api().hooksSave({ hooks: next })).data
    if (!result?.success) {
      showToast({ title: t("common.requestFailed"), description: result && !result.success ? result.error : undefined })
      return false
    }
    void refetch()
    return true
  }

  const open = (next: Draft) => {
    setDraft(reconcile(next))
    setTest(undefined)
    setEditing(false)
    setEditing(true)
  }

  const toHook = (): ModHook => ({
    id: draft.id,
    name: draft.name,
    event: draft.event,
    matcher: draft.matcher || undefined,
    command: draft.command,
    timeout: Number(draft.timeout) || 30,
    enabled: draft.enabled,
  })

  const save = async () => {
    setBusy(true)
    const hook = toHook()
    const list = hooks()
    const next = draft.id ? list.map((item) => (item.id === draft.id ? hook : item)) : [...list, hook]
    if (await write(next)) setEditing(false)
    setBusy(false)
  }

  const runTest = async () => {
    setBusy(true)
    const result = (await api().hooksTest({ command: draft.command, event: draft.event })).data
    setBusy(false)
    setTest(
      result
        ? `exit ${result.code}\n${result.stdout}${result.stderr ? `\n[stderr] ${result.stderr}` : ""}`
        : t("common.requestFailed"),
    )
  }

  return (
    <>
      <ModTabHeader
        title={t("mod.hooks.title")}
        description={t("mod.hooks.description")}
        actions={
          <Show when={!editing()}>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => open(empty())}>
              {t("mod.hooks.new")}
            </ButtonV2>
          </Show>
        }
      />
      <div class="settings-v2-tab-body">
        <Show when={editing()}>
          <form
            ref={revealEditor}
            class="mod-editor"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <h3 class="mod-editor-title">{draft.name || t("mod.hooks.new")}</h3>
            <div class="mod-editor-grid">
              <ModField label={t("mod.field.name")}>
                <TextInputV2 value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
              </ModField>
              <ModField label={t("mod.hooks.field.event")} hint={t(`mod.hooks.event.${draft.event}`)}>
                <SelectV2
                  appearance="base"
                  options={EVENTS}
                  current={draft.event}
                  gutter={6}
                  label={(event) => event}
                  onSelect={(event) => event && setDraft("event", event)}
                />
              </ModField>
            </div>
            <div class="mod-editor-grid">
              <ModField label={t("mod.hooks.field.matcher")} hint={t("mod.hooks.field.matcher.hint")}>
                <TextInputV2
                  value={draft.matcher}
                  onInput={(event) => setDraft("matcher", event.currentTarget.value)}
                />
              </ModField>
              <ModField label={t("mod.hooks.field.timeout")}>
                <TextInputV2
                  type="number"
                  min="1"
                  value={draft.timeout}
                  onInput={(event) => setDraft("timeout", event.currentTarget.value)}
                />
              </ModField>
            </div>
            <ModField label={t("mod.hooks.field.command")} hint={t("mod.hooks.field.command.hint")}>
              <TextareaV2
                rows={4}
                value={draft.command}
                onInput={(event) => setDraft("command", event.currentTarget.value)}
              />
            </ModField>
            <Show when={test()}>{(output) => <pre class="mod-hooks-test">{output()}</pre>}</Show>
            <div class="mod-editor-actions">
              <ButtonV2
                type="button"
                size="normal"
                variant="ghost-muted"
                disabled={busy() || !draft.command.trim()}
                onClick={() => void runTest()}
              >
                {t("mod.hooks.test")}
              </ButtonV2>
              <ButtonV2 type="button" size="normal" variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </ButtonV2>
              <ButtonV2 type="submit" size="normal" variant="contrast" disabled={busy()}>
                {t("common.save")}
              </ButtonV2>
            </div>
          </form>
        </Show>

        <div class="settings-v2-section">
          <SettingsListV2>
            <Show
              when={hooks().length > 0}
              fallback={<div class="settings-v2-provider-empty">{t("mod.hooks.empty")}</div>}
            >
              <For each={hooks()}>
                {(hook) => (
                  <div class="settings-v2-provider-row">
                    <div class="settings-v2-provider-lead">
                      <div class="settings-v2-provider-copy">
                        <div class="settings-v2-provider-main">
                          <span class="settings-v2-provider-name">{hook.name}</span>
                          <Tag>{hook.event}</Tag>
                          <Show when={hook.matcher}>{(matcher) => <Tag>{matcher()}</Tag>}</Show>
                        </div>
                        <p class="settings-v2-provider-description mod-hooks-command">{hook.command}</p>
                      </div>
                    </div>
                    <div class="settings-v2-provider-actions">
                      <Switch
                        hideLabel
                        checked={hook.enabled}
                        onChange={(enabled: boolean) =>
                          void write(hooks().map((item) => (item.id === hook.id ? { ...item, enabled } : item)))
                        }
                      >
                        {t("mod.schedule.enabled")}
                      </Switch>
                      <ButtonV2
                        size="normal"
                        variant="ghost-muted"
                        onClick={() =>
                          open({
                            id: hook.id,
                            name: hook.name,
                            event: hook.event,
                            matcher: hook.matcher ?? "",
                            command: hook.command,
                            timeout: String(hook.timeout ?? 30),
                            enabled: hook.enabled,
                          })
                        }
                      >
                        {t("common.edit")}
                      </ButtonV2>
                      <DeleteButton onConfirm={() => void write(hooks().filter((item) => item.id !== hook.id))} />
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{t("mod.templates")}</h3>
          <div class="mod-templates">
            <For each={TEMPLATES}>
              {(template) => (
                <button
                  type="button"
                  class="mod-template"
                  onClick={() => open({ ...template, timeout: "30", enabled: true })}
                >
                  <span class="mod-template-title">{template.name}</span>
                  <span class="mod-template-description">
                    {template.event}
                    {template.matcher ? ` · ${template.matcher}` : ""}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </>
  )
}
