import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Select, Switch, TextInput, Textarea, useExtension } from "./ui"
import type { ModConfig } from "./data"
import type definition from "./index"
import {
  compact,
  EFFECTS,
  modelText,
  parseRules,
  record,
  setEffect,
  text,
  validModel,
  type Effect,
  type Rule,
} from "./model"
import { EditorActions, EditorCard, EntryList, Field, nameError, TabHeader, useSave } from "./shared"
import { AGENT_TEMPLATES, type AgentTemplate, type LimitedAction } from "./templates"

type Mode = "primary" | "subagent" | "all"

const MODES: readonly Mode[] = ["primary", "subagent", "all"]

const LIMITED: readonly LimitedAction[] = ["edit", "shell", "webfetch"]

type Limit = Effect | "default"

const LIMITS: readonly Limit[] = ["default", ...EFFECTS]

type Draft = {
  original?: string
  name: string
  description: string
  mode: Mode
  model: string
  steps: string
  color: string
  prompt: string
  hidden: boolean
  disabled: boolean
  limits: Record<LimitedAction, Limit>
}

const empty = (): Draft => ({
  name: "",
  description: "",
  mode: "all",
  model: "",
  steps: "",
  color: "",
  prompt: "",
  hidden: false,
  disabled: false,
  limits: { edit: "default", shell: "default", webfetch: "default" },
})

function fromConfig(name: string, config: Record<string, unknown>): Draft {
  const rules = parseRules(config.permissions)

  const limit = (action: LimitedAction): Limit =>
    rules.findLast((rule) => rule.action === action && rule.resource === "*")?.effect ?? "default"

  const mode = config.mode

  return {
    original: name,
    name,
    description: text(config.description),
    mode: mode === "primary" || mode === "subagent" ? mode : "all",
    model: modelText(config.model),
    steps: typeof config.steps === "number" ? String(config.steps) : "",
    color: text(config.color),
    prompt: text(config.system),
    hidden: config.hidden === true,
    disabled: config.disabled === true,
    limits: { edit: limit("edit"), shell: limit("shell"), webfetch: limit("webfetch") },
  }
}

function fromTemplate(template: AgentTemplate): Draft {
  return {
    ...empty(),
    name: template.name,
    description: template.description,
    mode: template.mode,
    prompt: template.prompt,
    limits: { edit: "default", shell: "default", webfetch: "default", ...template.limits },
  }
}

/** The agent entry to save: the previous entry's other fields, with the edited ones replaced. */
export function toConfig(draft: Draft, previous: Record<string, unknown> = {}) {
  // Rules the editor does not manage (other actions, specific resources) are kept; each limit goes before the
  // specific rules of its action so those still override it.
  const permissions = LIMITED.reduce(
    (rules: Rule[], action) =>
      setEffect(rules, action, draft.limits[action] === "default" ? undefined : draft.limits[action]),
    parseRules(previous.permissions),
  )

  const { description, mode, model, steps, color, system, hidden, disabled, permissions: _, ...rest } = previous

  return {
    ...rest,
    ...compact({
      description: draft.description.trim(),
      mode: draft.mode === "all" ? undefined : draft.mode,
      model: draft.model.trim(),
      steps: draft.steps.trim() ? Number(draft.steps) : undefined,
      color: draft.color.trim(),
      system: draft.prompt.trim(),
      hidden: draft.hidden || undefined,
      disabled: draft.disabled || undefined,
      permissions: permissions.length ? permissions : undefined,
    }),
  }
}

export default function AgentsTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)
  const agents = createMemo(() => record(props.config.values().agents))
  const names = createMemo(() => Object.keys(agents()).sort())
  const [draft, setDraft] = createStore<Draft>(empty())
  const [open, setOpen] = createSignal(false)
  const [showErrors, setShowErrors] = createSignal(false)

  const errors = createMemo(() =>
    compact({
      name: nameError(draft.name, names(), draft.original, ctx.t),
      model: validModel(draft.model.trim()) ? undefined : ctx.t("model.invalid"),
      steps: draft.steps.trim() && !/^[1-9]\d*$/.test(draft.steps.trim()) ? ctx.t("agents.steps.invalid") : undefined,
      color:
        draft.color.trim() && !/^#[0-9a-fA-F]{6}$/.test(draft.color.trim()) ? ctx.t("agents.color.invalid") : undefined,
    }),
  )

  const edit = (next: Draft) => {
    save.clear()
    setShowErrors(false)
    setDraft(next)
    setOpen(true)
  }

  const submit = async () => {
    setShowErrors(true)

    if (Object.keys(errors()).length) return
    const name = draft.name.trim()
    const value = toConfig(draft, draft.original ? agents()[draft.original] : undefined)

    if (!(await save.run(["agents", name], value))) return

    // A rename moves the entry: the new one is saved first, so a failure never loses it.
    if (draft.original && draft.original !== name) await save.run(["agents", draft.original], undefined)
    setOpen(false)
  }

  const describe = (name: string) => {
    const agent = agents()[name] ?? {}

    return [text(agent.description), modelText(agent.model), agent.disabled === true ? ctx.t("disabled") : ""]
      .filter(Boolean)
      .join(" · ")
  }

  return (
    <div class="flex flex-col gap-4">
      <TabHeader
        description={ctx.t("agents.description")}
        onNew={() => edit(empty())}
        templates={AGENT_TEMPLATES}
        templateLabel={(item) => item.title}
        onTemplate={(item) => edit(fromTemplate(item))}
      />

      <Show when={open()}>
        <EditorCard>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={ctx.t("name")} error={showErrors() ? errors().name : undefined}>
              <TextInput value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("agents.mode")}>
              <Select
                options={[...MODES]}
                current={draft.mode}
                label={(mode) => ctx.t(`agents.mode.${mode}`)}
                value={(mode) => mode}
                onSelect={(mode) => mode && setDraft("mode", mode)}
              />
            </Field>
            <Field label={ctx.t("field.description")}>
              <TextInput
                value={draft.description}
                onInput={(event) => setDraft("description", event.currentTarget.value)}
              />
            </Field>
            <Field
              label={ctx.t("model")}
              hint={ctx.t("model.placeholder")}
              error={showErrors() ? errors().model : undefined}
            >
              <TextInput
                value={draft.model}
                placeholder="opencode/big-pickle"
                onInput={(event) => setDraft("model", event.currentTarget.value)}
              />
            </Field>
            <Field label={ctx.t("agents.steps")} error={showErrors() ? errors().steps : undefined}>
              <TextInput
                numeric
                value={draft.steps}
                onInput={(event) => setDraft("steps", event.currentTarget.value)}
              />
            </Field>
            <Field label={ctx.t("agents.color")} error={showErrors() ? errors().color : undefined}>
              <TextInput
                value={draft.color}
                placeholder="#3b82f6"
                onInput={(event) => setDraft("color", event.currentTarget.value)}
              />
            </Field>
          </div>

          <Field label={ctx.t("agents.prompt")}>
            <Textarea
              rows={8}
              value={draft.prompt}
              onInput={(event) => setDraft("prompt", event.currentTarget.value)}
            />
          </Field>

          <div class="flex flex-col gap-2">
            <span class="text-12-medium text-v2-text-text-base">{ctx.t("agents.limits")}</span>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <For each={LIMITED}>
                {(action) => (
                  <Field label={action}>
                    <Select
                      options={[...LIMITS]}
                      current={draft.limits[action]}
                      label={(limit) =>
                        limit === "default" ? ctx.t("agents.limit.default") : ctx.t(`permissions.effect.${limit}`)
                      }
                      value={(limit) => limit}
                      onSelect={(limit) => limit && setDraft("limits", action, limit)}
                    />
                  </Field>
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-wrap gap-6">
            <Switch checked={draft.hidden} onChange={(checked) => setDraft("hidden", checked)}>
              {ctx.t("agents.hidden")}
            </Switch>
            <Switch checked={draft.disabled} onChange={(checked) => setDraft("disabled", checked)}>
              {ctx.t("disabled")}
            </Switch>
          </div>

          <EditorActions config={props.config} error={save.error()} onSave={submit} onCancel={() => setOpen(false)} />
        </EditorCard>
      </Show>

      <EntryList
        names={names()}
        describe={describe}
        onEdit={(name) => edit(fromConfig(name, agents()[name] ?? {}))}
        onDelete={(name) => save.run(["agents", name], undefined)}
      />
    </div>
  )
}
