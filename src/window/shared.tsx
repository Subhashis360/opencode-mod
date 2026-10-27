import { createSignal, For, Show, type JSX } from "solid-js"
import { Button, Select, useExtension } from "./ui"
import type { ModConfig } from "./data"
import type definition from "./index"
import { ENTRY_NAME, isPlainObject } from "./model"

// The host's settings row markup; its stylesheet is loaded with the settings screen.
export function Row(props: { title: string; description?: string; children?: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <Show when={props.description}>
          <div data-slot="settings-row-description">{props.description}</div>
        </Show>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}

export function Field(props: { label: string; error?: string; hint?: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-1">
      <span class="text-12-medium text-v2-text-text-base">{props.label}</span>
      {props.children}
      <Show when={props.error}>
        <span class="text-11-regular text-text-danger-base" role="alert">
          {props.error}
        </span>
      </Show>
      <Show when={!props.error && props.hint}>
        <span class="text-11-regular text-v2-text-text-muted">{props.hint}</span>
      </Show>
    </label>
  )
}

export function ErrorText(props: { message?: string }) {
  return (
    <Show when={props.message}>
      <p class="text-12-regular text-text-danger-base" role="alert">
        {props.message}
      </p>
    </Show>
  )
}

/** A section header with the tab's description, its New button and an optional template picker. */
export function TabHeader<T>(props: {
  description: string
  onNew: () => void
  templates?: readonly T[]
  templateLabel?: (item: T) => string
  onTemplate?: (item: T) => void
}) {
  const ctx = useExtension<typeof definition>()

  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{props.description}</p>
      <div class="flex items-center gap-2">
        <Show when={props.templates?.length}>
          <Select
            options={[...(props.templates ?? [])]}
            placeholder={ctx.t("template")}
            label={(item) => props.templateLabel?.(item) ?? ""}
            value={(item) => props.templateLabel?.(item) ?? ""}
            onSelect={(item) => item && props.onTemplate?.(item)}
          />
        </Show>
        <Button variant="neutral" onClick={props.onNew}>
          {ctx.t("new")}
        </Button>
      </div>
    </div>
  )
}

/** The saved entries of one config key, each with Edit and a Delete that asks once more. */
export function EntryList(props: {
  names: readonly string[]
  describe: (name: string) => string
  onEdit: (name: string) => void
  onDelete: (name: string) => Promise<unknown>
}) {
  const ctx = useExtension<typeof definition>()
  const [confirming, setConfirming] = createSignal<string>()

  return (
    <div data-component="settings-list">
      <Show when={props.names.length} fallback={<Row title={ctx.t("empty")} />}>
        <For each={props.names}>
          {(name) => (
            <Row title={name} description={props.describe(name)}>
              <div class="flex items-center gap-2">
                <Button variant="ghost" onClick={() => props.onEdit(name)}>
                  {ctx.t("edit")}
                </Button>
                <Show
                  when={confirming() === name}
                  fallback={
                    <Button variant="ghost" onClick={() => setConfirming(name)}>
                      {ctx.t("delete")}
                    </Button>
                  }
                >
                  <Button
                    variant="danger"
                    onClick={() => void props.onDelete(name).finally(() => setConfirming(undefined))}
                  >
                    {ctx.t("delete.confirm")}
                  </Button>
                </Show>
              </div>
            </Row>
          )}
        </For>
      </Show>
    </div>
  )
}

/** The editor card's Save and Cancel buttons and the save error. */
export function EditorActions(props: { config: ModConfig; onSave: () => void; onCancel: () => void; error?: string }) {
  const ctx = useExtension<typeof definition>()

  return (
    <div class="flex flex-col gap-2">
      <ErrorText message={props.error} />
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onClick={props.onCancel}>
          {ctx.t("cancel")}
        </Button>
        <Button variant="submit" disabled={props.config.saving()} onClick={props.onSave}>
          {ctx.t("save")}
        </Button>
      </div>
    </div>
  )
}

export function EditorCard(props: { children: JSX.Element }) {
  return <div class="flex flex-col gap-3 rounded-md border border-v2-border-border-base p-4">{props.children}</div>
}

/** A thrown Error, or an RPC failure, which the client throws as a plain `{ type, message }` object. */
export function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message

  if (isPlainObject(cause) && typeof cause.message === "string") return cause.message

  return String(cause)
}

/** Runs a save and turns a failure into the message the editor shows. */
export function useSave(config: ModConfig) {
  const ctx = useExtension<typeof definition>()
  const [error, setError] = createSignal<string>()

  const run = async (path: string[], value?: unknown) => {
    setError(undefined)

    try {
      await config.save(path, value)

      return true
    } catch (cause) {
      setError(ctx.t("save.error", { error: errorMessage(cause) }))

      return false
    }
  }

  return { error, run, clear: () => setError(undefined) }
}

export function nameError(
  name: string,
  taken: readonly string[],
  original: string | undefined,
  t: (key: "name.invalid" | "name.taken") => string,
) {
  if (!ENTRY_NAME.test(name)) return t("name.invalid")

  if (name !== original && taken.includes(name)) return t("name.taken")

  return undefined
}
