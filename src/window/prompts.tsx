import { createMemo, createSignal, Show } from "solid-js"
import { Button, Select, TextInput, Textarea, useExtension } from "./ui"
import { useModPrompts, type ModConfig } from "./data"
import type definition from "./index"
import { isPlainObject, record, text } from "./model"
import { ErrorText, errorMessage, Field, Row } from "./shared"

// OpenCode's own agents; their prompt is overridden through the same `system` field as a custom agent's.
const BUILT_IN = ["build", "plan"]

type Source = { label: string; content: string }

// What each of OpenCode's prompt files is for; OpenCode picks one by the model's name.
const MODEL_PROMPTS: Record<string, string> = {
  default: "default (most models)",
  anthropic: "Claude models",
  gpt: "GPT models",
  "gpt-astra": "GPT Astra",
  kimi: "Kimi models",
  meta: "Meta Muse models",
  trinity: "Arcee Trinity models",
}

export default function PromptsTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const prompts = useModPrompts()
  const [agent, setAgent] = createSignal("build")
  const [draft, setDraft] = createSignal<string>()
  const [name, setName] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [saved, setSaved] = createSignal<string>()

  const agents = createMemo(() => [...new Set([...BUILT_IN, ...Object.keys(record(props.config.values().agents))])])

  const current = () => {
    const entry = record(props.config.values().agents)[agent()]

    return isPlainObject(entry) ? text(entry.system) : ""
  }

  // The prompt the agent runs with when it has none of its own: OpenCode's base prompt, which most models get.
  const builtin = () => prompts.upstream.data?.default ?? ""
  const showingBuiltin = () => draft() === undefined && !current() && !!builtin()
  const content = () => draft() ?? (current() || builtin())

  // Starting points: OpenCode's current built-in prompts and the user's own library.
  const sources = createMemo((): Source[] => [
    ...Object.entries(prompts.upstream.data ?? {}).map(([id, value]) => ({
      label: ctx.t("prompts.builtin", { name: MODEL_PROMPTS[id] ?? id }),
      content: value,
    })),
    ...(prompts.library.data ?? []).map((item) => ({ label: item.name, content: item.content })),
  ])

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(undefined)
    setSaved(undefined)

    try {
      await fn()
      setSaved(done)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const apply = () =>
    act(async () => {
      const value = content().trim()
      // Saving the built-in prompt unchanged would freeze today's wording; leave the agent on the built-in one.
      const own = value && !(value === builtin().trim() && !current())

      await props.config.save(["agents", agent(), "system"], own ? value : undefined)
      setDraft(undefined)
    }, ctx.t("prompts.saved"))

  const reset = () =>
    act(async () => {
      await props.config.save(["agents", agent(), "system"], undefined)
      setDraft(undefined)
    }, ctx.t("prompts.reset.done"))

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("prompts.description")}</p>

      <div data-component="settings-list">
        <Row
          title={ctx.t("prompts.agent")}
          description={current() ? ctx.t("prompts.custom") : ctx.t("prompts.default")}
        >
          <Select
            options={agents()}
            current={agent()}
            label={(item) => item}
            value={(item) => item}
            onSelect={(item) => {
              if (!item) return
              setAgent(item)
              setDraft(undefined)
            }}
          />
        </Row>
        <Row title={ctx.t("prompts.start")} description={ctx.t("prompts.start.description")}>
          <Select
            options={sources()}
            placeholder={prompts.upstream.isPending ? ctx.t("config.loading") : ctx.t("template")}
            label={(item) => item.label}
            value={(item) => item.label}
            onSelect={(item) => item && setDraft(item.content)}
          />
        </Row>
      </div>

      <Field
        label={ctx.t("agents.prompt")}
        hint={
          showingBuiltin()
            ? ctx.t("prompts.showingBuiltin")
            : prompts.upstream.isPending && !current()
              ? ctx.t("config.loading")
              : ctx.t("prompts.hint")
        }
      >
        <Textarea rows={16} value={content()} onInput={(event) => setDraft(event.currentTarget.value)} />
      </Field>

      <ErrorText message={error()} />
      <Show when={saved()}>
        <p class="text-12-regular text-v2-text-text-muted">{saved()}</p>
      </Show>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <TextInput
            value={name()}
            placeholder={ctx.t("prompts.name")}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <Button
            variant="ghost"
            disabled={!name().trim() || !content().trim()}
            onClick={() => void act(() => prompts.keep({ name: name(), content: content() }), ctx.t("prompts.kept"))}
          >
            {ctx.t("prompts.keep")}
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" disabled={!current()} onClick={() => void reset()}>
            {ctx.t("prompts.reset")}
          </Button>
          <Button variant="submit" onClick={() => void apply()}>
            {ctx.t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
