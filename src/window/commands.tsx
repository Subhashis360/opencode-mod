import { createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Switch, TextInput, Textarea, useExtension } from "./ui"
import type { ModConfig } from "./data"
import type definition from "./index"
import { compact, modelText, record, text, validModel } from "./model"
import { EditorActions, EditorCard, EntryList, Field, nameError, TabHeader, useSave } from "./shared"
import { COMMAND_TEMPLATES, type CommandTemplate } from "./templates"

type Draft = {
  original?: string
  name: string
  description: string
  template: string
  agent: string
  model: string
  subagent: boolean
}

const empty = (): Draft => ({ name: "", description: "", template: "", agent: "", model: "", subagent: false })

function fromConfig(name: string, config: Record<string, unknown>): Draft {
  return {
    original: name,
    name,
    description: text(config.description),
    template: text(config.template),
    agent: text(config.agent),
    model: modelText(config.model),
    subagent: config.subagent === true || config.subtask === true,
  }
}

function fromTemplate(template: CommandTemplate): Draft {
  return {
    ...empty(),
    name: template.name,
    description: template.description,
    template: template.template,
    subagent: template.subagent === true,
  }
}

/** The command entry to save: the previous entry's other fields, with the edited ones replaced. */
export function toConfig(draft: Draft, previous: Record<string, unknown> = {}) {
  const { description, template, agent, model, subagent, subtask, ...rest } = previous

  return {
    ...rest,
    template: draft.template,
    ...compact({
      description: draft.description.trim(),
      agent: draft.agent.trim(),
      model: draft.model.trim(),
      subagent: draft.subagent || undefined,
    }),
  }
}

export default function CommandsTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)
  const commands = createMemo(() => record(props.config.values().commands))
  const names = createMemo(() => Object.keys(commands()).sort())
  const [draft, setDraft] = createStore<Draft>(empty())
  const [open, setOpen] = createSignal(false)
  const [showErrors, setShowErrors] = createSignal(false)

  const errors = createMemo(() =>
    compact({
      name: nameError(draft.name, names(), draft.original, ctx.t),
      model: validModel(draft.model.trim()) ? undefined : ctx.t("model.invalid"),
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

    if (!(await save.run(["commands", name], toConfig(draft, draft.original ? commands()[draft.original] : undefined))))
      return

    if (draft.original && draft.original !== name) await save.run(["commands", draft.original], undefined)
    setOpen(false)
  }

  return (
    <div class="flex flex-col gap-4">
      <TabHeader
        description={ctx.t("commands.description")}
        onNew={() => edit(empty())}
        templates={COMMAND_TEMPLATES}
        templateLabel={(item) => `/${item.name}`}
        onTemplate={(item) => edit(fromTemplate(item))}
      />

      <Show when={open()}>
        <EditorCard>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={ctx.t("name")} error={showErrors() ? errors().name : undefined}>
              <TextInput value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("field.description")}>
              <TextInput
                value={draft.description}
                onInput={(event) => setDraft("description", event.currentTarget.value)}
              />
            </Field>
            <Field label={ctx.t("commands.agent")} hint={ctx.t("commands.agent.placeholder")}>
              <TextInput value={draft.agent} onInput={(event) => setDraft("agent", event.currentTarget.value)} />
            </Field>
            <Field
              label={ctx.t("model")}
              hint={ctx.t("model.placeholder")}
              error={showErrors() ? errors().model : undefined}
            >
              <TextInput value={draft.model} onInput={(event) => setDraft("model", event.currentTarget.value)} />
            </Field>
          </div>
          <Field label={ctx.t("commands.template")}>
            <Textarea
              rows={6}
              value={draft.template}
              onInput={(event) => setDraft("template", event.currentTarget.value)}
            />
          </Field>
          <Switch checked={draft.subagent} onChange={(checked) => setDraft("subagent", checked)}>
            {ctx.t("commands.subagent")}
          </Switch>
          <EditorActions config={props.config} error={save.error()} onSave={submit} onCancel={() => setOpen(false)} />
        </EditorCard>
      </Show>

      <EntryList
        names={names()}
        describe={(name) => text(commands()[name]?.description)}
        onEdit={(name) => edit(fromConfig(name, commands()[name] ?? {}))}
        onDelete={(name) => save.run(["commands", name], undefined)}
      />
    </div>
  )
}
