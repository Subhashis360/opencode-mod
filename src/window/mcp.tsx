import { createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SegmentedControl, SegmentedControlItem, Switch, TextInput, Textarea, useExtension } from "./ui"
import type { ModConfig } from "./data"
import type definition from "./index"
import { compact, formatPairs, isPlainObject, joinCommand, parsePairs, record, splitCommand, text } from "./model"
import { EditorActions, EditorCard, EntryList, Field, nameError, TabHeader, useSave } from "./shared"
import { MCP_TEMPLATES, type McpTemplate } from "./templates"

type Kind = "local" | "remote"

type Draft = {
  original?: string
  name: string
  type: Kind
  command: string
  environment: string
  url: string
  headers: string
  disabled: boolean
}

const empty = (): Draft => ({
  name: "",
  type: "local",
  command: "",
  environment: "",
  url: "",
  headers: "",
  disabled: false,
})

function fromConfig(name: string, config: Record<string, unknown>): Draft {
  return {
    original: name,
    name,
    type: config.type === "remote" ? "remote" : "local",
    command: Array.isArray(config.command)
      ? joinCommand(config.command.filter((arg): arg is string => typeof arg === "string"))
      : "",
    environment: formatPairs(config.environment),
    url: text(config.url),
    headers: formatPairs(config.headers),
    disabled: config.disabled === true,
  }
}

function fromTemplate(template: McpTemplate): Draft {
  if (template.type === "remote")
    return {
      ...empty(),
      name: template.name,
      type: "remote",
      url: template.url,
      headers: formatPairs(template.headers),
    }

  return {
    ...empty(),
    name: template.name,
    type: "local",
    command: joinCommand(template.command),
    environment: formatPairs(template.environment),
  }
}

const pairs = (lines: string) => {
  const value = parsePairs(lines)

  return Object.keys(value).length ? value : undefined
}

/** The server entry to save. Switching between local and remote drops the other kind's fields. */
export function toConfig(draft: Draft, previous: Record<string, unknown> = {}) {
  const { type, command, environment, url, headers, disabled, oauth, cwd, ...rest } = previous
  const sameKind = previous.type === draft.type
  const kept = { ...rest, ...(sameKind && draft.type === "remote" && oauth !== undefined ? { oauth } : {}) }
  const keptCwd = sameKind && draft.type === "local" && typeof cwd === "string" ? { cwd } : {}

  if (draft.type === "remote")
    return {
      ...kept,
      type: "remote",
      url: draft.url.trim(),
      ...compact({ headers: pairs(draft.headers), disabled: draft.disabled || undefined }),
    }

  return {
    ...kept,
    ...keptCwd,
    type: "local",
    command: splitCommand(draft.command),
    ...compact({ environment: pairs(draft.environment), disabled: draft.disabled || undefined }),
  }
}

export default function McpTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)

  const servers = createMemo(() => {
    const mcp = props.config.values().mcp

    return record(isPlainObject(mcp) ? mcp.servers : undefined)
  })

  const names = createMemo(() => Object.keys(servers()).sort())
  const [draft, setDraft] = createStore<Draft>(empty())
  const [open, setOpen] = createSignal(false)
  const [showErrors, setShowErrors] = createSignal(false)

  const errors = createMemo(() =>
    compact({
      name: nameError(draft.name, names(), draft.original, ctx.t),
      command: draft.type === "local" && !splitCommand(draft.command).length ? ctx.t("mcp.command.invalid") : undefined,
      url: draft.type === "remote" && !/^https?:\/\/\S+$/.test(draft.url.trim()) ? ctx.t("mcp.url.invalid") : undefined,
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
    const value = toConfig(draft, draft.original ? servers()[draft.original] : undefined)

    if (!(await save.run(["mcp", "servers", name], value))) return

    if (draft.original && draft.original !== name) await save.run(["mcp", "servers", draft.original], undefined)
    setOpen(false)
  }

  const describe = (name: string) => {
    const server = servers()[name] ?? {}

    const target =
      server.type === "remote"
        ? text(server.url)
        : Array.isArray(server.command)
          ? joinCommand(server.command.filter((arg): arg is string => typeof arg === "string"))
          : ""

    return [server.type === "remote" ? ctx.t("mcp.type.remote") : ctx.t("mcp.type.local"), target]
      .concat(server.disabled === true ? [ctx.t("disabled")] : [])
      .filter(Boolean)
      .join(" · ")
  }

  return (
    <div class="flex flex-col gap-4">
      <TabHeader
        description={ctx.t("mcp.description")}
        onNew={() => edit(empty())}
        templates={MCP_TEMPLATES}
        templateLabel={(item) => item.title}
        onTemplate={(item) => edit(fromTemplate(item))}
      />

      <Show when={open()}>
        <EditorCard>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={ctx.t("name")} error={showErrors() ? errors().name : undefined}>
              <TextInput value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("mcp.type")}>
              <SegmentedControl
                value={draft.type}
                onChange={(value) => value && setDraft("type", value === "remote" ? "remote" : "local")}
              >
                <SegmentedControlItem value="local">{ctx.t("mcp.type.local")}</SegmentedControlItem>
                <SegmentedControlItem value="remote">{ctx.t("mcp.type.remote")}</SegmentedControlItem>
              </SegmentedControl>
            </Field>
          </div>

          <Show
            when={draft.type === "remote"}
            fallback={
              <>
                <Field label={ctx.t("mcp.command")} error={showErrors() ? errors().command : undefined}>
                  <TextInput
                    value={draft.command}
                    placeholder={ctx.t("mcp.command.placeholder")}
                    onInput={(event) => setDraft("command", event.currentTarget.value)}
                  />
                </Field>
                <Field label={ctx.t("mcp.environment")} hint={ctx.t("mcp.pairs.placeholder")}>
                  <Textarea
                    rows={3}
                    value={draft.environment}
                    onInput={(event) => setDraft("environment", event.currentTarget.value)}
                  />
                </Field>
              </>
            }
          >
            <Field label={ctx.t("mcp.url")} error={showErrors() ? errors().url : undefined}>
              <TextInput
                value={draft.url}
                placeholder="https://"
                onInput={(event) => setDraft("url", event.currentTarget.value)}
              />
            </Field>
            <Field label={ctx.t("mcp.headers")} hint={ctx.t("mcp.pairs.placeholder")}>
              <Textarea
                rows={3}
                value={draft.headers}
                onInput={(event) => setDraft("headers", event.currentTarget.value)}
              />
            </Field>
          </Show>

          <Switch checked={draft.disabled} onChange={(checked) => setDraft("disabled", checked)}>
            {ctx.t("disabled")}
          </Switch>
          <EditorActions config={props.config} error={save.error()} onSave={submit} onCancel={() => setOpen(false)} />
        </EditorCard>
      </Show>

      <EntryList
        names={names()}
        describe={describe}
        onEdit={(name) => edit(fromConfig(name, servers()[name] ?? {}))}
        onDelete={(name) => save.run(["mcp", "servers", name], undefined)}
      />
    </div>
  )
}
