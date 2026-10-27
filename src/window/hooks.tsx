import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Mod } from "../server/rpc"
import { Button, Select, Switch, TextInput, Textarea, useExtension } from "./ui"
import { useModHooks } from "./data"
import type definition from "./index"
import { EditorCard, ErrorText, errorMessage, Field, Row } from "./shared"

type Hook = Mod.Hook
type Draft = { -readonly [K in keyof Hook]: Hook[K] }
type Event = Hook["event"]

const EVENTS: readonly Event[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionIdle",
  "PermissionAsked",
  "SessionError",
]

// Starting points; nothing is saved until the user reviews and saves.
const TEMPLATES: readonly Omit<Hook, "id">[] = [
  {
    name: "Block risky shell commands",
    event: "PreToolUse",
    matcher: "shell",
    command:
      "$e = $input | ConvertFrom-Json; if ($e.input.command -match 'rm -rf|Remove-Item -Recurse|git push --force') { [Console]::Error.WriteLine('Risky command blocked by hook'); exit 2 }",
    timeout: 10,
    enabled: true,
  },
  {
    name: "Log every tool call",
    event: "PostToolUse",
    matcher: "*",
    command: '$input | Add-Content -Path "$env:USERPROFILE\\opencode-tools.log"',
    timeout: 10,
    enabled: true,
  },
  {
    name: "Add the git branch to prompts",
    event: "UserPromptSubmit",
    command: "git branch --show-current",
    timeout: 10,
    enabled: true,
  },
  {
    name: "Beep when the agent is done",
    event: "SessionIdle",
    command: "[console]::beep(880,200)",
    timeout: 5,
    enabled: true,
  },
]

const empty = (): Draft => ({ name: "", event: "PreToolUse", matcher: "", command: "", timeout: 30, enabled: true })

export default function HooksTab() {
  const ctx = useExtension<typeof definition>()
  const data = useModHooks()
  const [draft, setDraft] = createStore<Draft>(empty())
  const [open, setOpen] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [tested, setTested] = createSignal<string>()

  const list = () => data.hooks.data ?? []

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

  const edit = (hook: Hook) => {
    setError(undefined)
    setTested(undefined)
    setDraft({ ...empty(), ...hook })
    setOpen(true)
  }

  // Hooks are saved as one list: the edited one replaces its old entry or is added.
  const save = async () => {
    const hook = { ...draft }
    const next = hook.id ? list().map((item) => (item.id === hook.id ? hook : item)) : [...list(), hook]

    if (await act(() => data.save(next))) setOpen(false)
  }

  const test = () =>
    act(async () => {
      const result = await data.test(draft.command, draft.event)

      setTested(
        ctx.t("hooks.tested", { code: result.code, output: (result.stdout || result.stderr || "").slice(0, 400) }),
      )
    })

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("hooks.description")}</p>
        <div class="flex items-center gap-2">
          <Select
            options={[...TEMPLATES]}
            placeholder={ctx.t("template")}
            label={(item) => item.name}
            value={(item) => item.name}
            onSelect={(item) => item && edit(item)}
          />
          <Button variant="neutral" onClick={() => edit(empty())}>
            {ctx.t("new")}
          </Button>
        </div>
      </div>

      <Show when={open()}>
        <EditorCard>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label={ctx.t("name")}>
              <TextInput value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("hooks.event")} hint={ctx.t(`hooks.event.${draft.event}`)}>
              <Select
                options={[...EVENTS]}
                current={draft.event}
                label={(event) => event}
                value={(event) => event}
                onSelect={(event) => event && setDraft("event", event)}
              />
            </Field>
            <Field label={ctx.t("hooks.matcher")} hint={ctx.t("hooks.matcher.hint")}>
              <TextInput
                value={draft.matcher ?? ""}
                placeholder="*"
                onInput={(event) => setDraft("matcher", event.currentTarget.value)}
              />
            </Field>
          </div>
          <Field label={ctx.t("hooks.command")} hint={ctx.t("hooks.command.hint")}>
            <Textarea
              rows={3}
              value={draft.command}
              onInput={(event) => setDraft("command", event.currentTarget.value)}
            />
          </Field>
          <div class="flex flex-wrap items-end gap-6">
            <Field label={ctx.t("hooks.timeout")}>
              <TextInput
                numeric
                value={String(draft.timeout ?? 30)}
                onInput={(event) => setDraft("timeout", Number(event.currentTarget.value) || 30)}
              />
            </Field>
            <Switch checked={draft.enabled} onChange={(checked) => setDraft("enabled", checked)}>
              {ctx.t("hooks.enabled")}
            </Switch>
            <Button variant="ghost" disabled={!draft.command.trim()} onClick={() => void test()}>
              {ctx.t("hooks.test")}
            </Button>
          </div>
          <Show when={tested()}>
            <pre class="text-11-regular whitespace-pre-wrap text-v2-text-text-muted">{tested()}</pre>
          </Show>
          <ErrorText message={error()} />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {ctx.t("cancel")}
            </Button>
            <Button variant="submit" onClick={() => void save()}>
              {ctx.t("save")}
            </Button>
          </div>
        </EditorCard>
      </Show>

      <Show when={!open()}>
        <ErrorText message={error()} />
      </Show>

      <div data-component="settings-list">
        <Show when={list().length} fallback={<Row title={ctx.t("empty")} />}>
          <For each={list()}>
            {(hook) => (
              <Row title={hook.name} description={`${hook.event}${hook.matcher ? ` · ${hook.matcher}` : ""}`}>
                <div class="flex items-center gap-2">
                  <Switch
                    hideLabel
                    checked={hook.enabled}
                    onChange={(enabled) =>
                      void act(() =>
                        data.save(list().map((item) => (item.id === hook.id ? { ...item, enabled } : item))),
                      )
                    }
                  >
                    {ctx.t("hooks.enabled")}
                  </Switch>
                  <Button variant="ghost" onClick={() => edit(hook)}>
                    {ctx.t("edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void act(() => data.save(list().filter((item) => item.id !== hook.id)))}
                  >
                    {ctx.t("delete")}
                  </Button>
                </div>
              </Row>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
