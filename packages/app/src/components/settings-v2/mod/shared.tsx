import type { Config } from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerProtocol } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { stalePaths, type PermissionAction } from "./entries"
import "./mod.css"

type Patch = Config
type Root = "agent" | "mcp" | "command" | "permission"

// Config writes for the mod tabs. Every tab edits the global config, and a patch is a deep merge,
// so saving an entry also deletes whatever the form dropped from it.
export function useModConfig() {
  const serverSync = useServerSync()
  const protocol = useServerProtocol()
  const language = useLanguage()

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action()
      showToast({ variant: "success", icon: "circle-check", title: success })
      return true
    } catch (err) {
      const description = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description })
      return false
    }
  }

  return {
    config: () => serverSync().data.config,
    available: () => protocol() === "v1",
    run,
    update: (patch: Patch) => serverSync().updateConfig(patch),
    remove: (path: string[]) => serverSync().removeConfig(path),
    saveEntry: (root: Root, name: string, before: unknown, after: Record<string, unknown>) =>
      run(
        async () => {
          await serverSync().updateConfig({ [root]: { [name]: after } } as Patch)
          for (const path of stalePaths(before, after)) await serverSync().removeConfig([root, name, ...path])
        },
        language.t("mod.toast.saved", { name }),
      ),
    deleteEntry: (root: Root, name: string) =>
      run(() => serverSync().removeConfig([root, name]), language.t("mod.toast.deleted", { name })),
  }
}

// Editors open at the top of the tab, which may be scrolled out of view when they are opened from
// a template further down.
export function revealEditor(element: HTMLElement) {
  requestAnimationFrame(() => element.scrollIntoView({ block: "start", behavior: "smooth" }))
}

export function ModTabHeader(props: { title: string; description: string; actions?: JSX.Element }) {
  return (
    <div class="settings-v2-tab-header">
      <div class="mod-tab-header">
        <div class="mod-tab-header-copy">
          <h2 class="settings-v2-tab-title">{props.title}</h2>
          <p class="mod-tab-description">{props.description}</p>
        </div>
        <Show when={props.actions}>
          <div class="mod-tab-header-actions">{props.actions}</div>
        </Show>
      </div>
    </div>
  )
}

export function ModField(props: { label: string; hint?: string; error?: string; children: JSX.Element }) {
  return (
    <div class="mod-field" data-invalid={props.error ? "" : undefined}>
      <span class="mod-field-label">{props.label}</span>
      {props.children}
      <Show
        when={props.error}
        fallback={<Show when={props.hint}>{(hint) => <span class="mod-field-hint">{hint()}</span>}</Show>}
      >
        {(error) => <span class="mod-field-error">{error()}</span>}
      </Show>
    </div>
  )
}

// A delete button that asks for a second click before acting.
export function DeleteButton(props: { onConfirm: () => void; label?: string; confirmLabel?: string }) {
  const language = useLanguage()
  const [armed, setArmed] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const click = () => {
    if (armed()) {
      clearTimeout(timer)
      setArmed(false)
      props.onConfirm()
      return
    }
    setArmed(true)
    timer = setTimeout(() => setArmed(false), 5000)
  }

  return (
    <ButtonV2 size="normal" variant={armed() ? "danger" : "ghost-muted"} onClick={click}>
      {armed()
        ? (props.confirmLabel ?? language.t("mod.action.confirmDelete"))
        : (props.label ?? language.t("common.delete"))}
    </ButtonV2>
  )
}

type ActionOption = { id: PermissionAction | "default"; label: string }

export function ActionSelect(props: {
  value: PermissionAction | "default" | "custom"
  onChange: (value: PermissionAction | "default") => void
  defaultLabel?: string
}) {
  const language = useLanguage()
  const options = createMemo<ActionOption[]>(() => [
    { id: "default", label: props.defaultLabel ?? language.t("mod.permission.default") },
    { id: "allow", label: language.t("mod.permission.allow") },
    { id: "ask", label: language.t("mod.permission.ask") },
    { id: "deny", label: language.t("mod.permission.deny") },
  ])
  const current = () => options().find((option) => option.id === props.value)
  return (
    <SelectV2
      appearance="inline"
      options={options()}
      current={current()}
      placeholder={props.value === "custom" ? language.t("mod.permission.custom") : undefined}
      placement="bottom-end"
      gutter={6}
      value={(option) => option.id}
      label={(option) => option.label}
      onSelect={(option) => option && props.onChange(option.id)}
    />
  )
}

type ModelOption = { id: string; label: string }

// Model picker over every connected provider. An empty id means "inherit the default model".
export function ModelSelect(props: { value: string; onChange: (value: string) => void }) {
  const language = useLanguage()
  const providers = useProviders(() => undefined)
  const options = createMemo<ModelOption[]>(() => {
    const models = providers.connected().flatMap((provider) =>
      Object.entries(provider.models).map(([id, model]) => ({
        id: `${provider.id}/${id}`,
        label: `${provider.name} / ${model.name ?? id}`,
      })),
    )
    // Keep a configured model selectable even when its provider is not connected right now.
    const missing = props.value && !models.some((model) => model.id === props.value)
    return [
      { id: "", label: language.t("mod.model.default") },
      ...(missing ? [{ id: props.value, label: props.value }] : []),
      ...models,
    ]
  })
  return (
    <SelectV2
      appearance="base"
      options={options()}
      current={options().find((option) => option.id === props.value)}
      gutter={6}
      value={(option) => option.id || "default"}
      label={(option) => option.label}
      onSelect={(option) => option && props.onChange(option.id)}
    />
  )
}

export function Unavailable() {
  const language = useLanguage()
  return <div class="settings-v2-provider-empty">{language.t("mod.unavailable")}</div>
}
