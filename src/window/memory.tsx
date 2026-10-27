import { createSignal, For, Show } from "solid-js"
import type { Mod } from "../server/rpc"
import { Button, Switch, Textarea, useExtension } from "./ui"
import { useModMemory } from "./data"
import type definition from "./index"
import { ErrorText, errorMessage, Row } from "./shared"

export default function MemoryTab() {
  const ctx = useExtension<typeof definition>()
  const data = useModMemory()
  const [editing, setEditing] = createSignal<{ id?: string; text: string }>()
  const [error, setError] = createSignal<string>()

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined)

    try {
      await fn()

      return true
    } catch (cause) {
      setError(errorMessage(cause))

      return false
    }
  }

  const where = (entry: Mod.MemoryEntry) =>
    entry.scope === "global" ? ctx.t("memory.global") : ctx.t("memory.project", { project: entry.project ?? "" })

  const save = async () => {
    const current = editing()

    if (!current) return
    const entry = data.memory.data?.entries.find((item) => item.id === current.id)
    const input = entry
      ? { id: entry.id, text: current.text, scope: entry.scope, ...(entry.project ? { project: entry.project } : {}) }
      : { text: current.text, scope: "global" as const }

    if (await act(() => data.save(input))) setEditing(undefined)
  }

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("memory.description")}</p>

      <Show when={data.memory.data}>
        {(memory) => (
          <>
            <div data-component="settings-list">
              <Row title={ctx.t("memory.enabled")} description={ctx.t("memory.enabled.description")}>
                <Switch
                  hideLabel
                  checked={memory().enabled}
                  onChange={(enabled) => void act(() => data.enable(enabled))}
                >
                  {ctx.t("memory.enabled")}
                </Switch>
              </Row>
            </div>

            <div class="flex justify-end">
              <Button variant="neutral" onClick={() => setEditing({ text: "" })}>
                {ctx.t("memory.add")}
              </Button>
            </div>

            <Show when={editing()}>
              {(current) => (
                <div class="flex flex-col gap-2">
                  <Textarea
                    rows={2}
                    value={current().text}
                    placeholder={ctx.t("memory.placeholder")}
                    onInput={(event) => setEditing({ ...current(), text: event.currentTarget.value })}
                  />
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setEditing(undefined)}>
                      {ctx.t("cancel")}
                    </Button>
                    <Button variant="submit" onClick={() => void save()}>
                      {ctx.t("save")}
                    </Button>
                  </div>
                </div>
              )}
            </Show>

            <ErrorText message={error()} />

            <div data-component="settings-list">
              <Show when={memory().entries.length} fallback={<Row title={ctx.t("memory.empty")} />}>
                <For each={[...memory().entries].sort((a, b) => b.updated - a.updated)}>
                  {(entry) => (
                    <Row title={entry.text} description={where(entry)}>
                      <div class="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => setEditing({ id: entry.id, text: entry.text })}>
                          {ctx.t("edit")}
                        </Button>
                        <Button variant="ghost" onClick={() => void act(() => data.remove(entry.id))}>
                          {ctx.t("delete")}
                        </Button>
                      </div>
                    </Row>
                  )}
                </For>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
