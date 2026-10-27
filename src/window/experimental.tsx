import { createMemo, createSignal, For, type JSX } from "solid-js"
import { Button, Select, Switch, TextInput, useExtension } from "./ui"
import type { ModConfig } from "./data"
import type definition from "./index"
import { isPlainObject } from "./model"
import { ErrorText, Row, useSave } from "./shared"

// OpenCode 2 keeps these in the config file: engine features in its `experimental` section, the speed settings at
// the top level. Each switch writes only when it differs from OpenCode's default, so the file stays small.
const ENGINE = ["todo", "portable_shell_scanner"] as const

const SEARCH = ["default", "parallel", "exa", "tavily", "random", "off"] as const
type Search = (typeof SEARCH)[number]

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <h3 class="settings-section-title">{props.title}</h3>
      <div data-component="settings-list">{props.children}</div>
    </div>
  )
}

export default function ExperimentalTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)

  const values = () => props.config.values()
  const experimental = createMemo(() => {
    const value = values().experimental

    return isPlainObject(value) ? value : {}
  })

  // What the user is typing; until they type, each field shows the saved value.
  const [depthDraft, setDepth] = createSignal<string>()
  const [idleDraft, setIdle] = createSignal<string>()
  const [linesDraft, setLines] = createSignal<string>()
  const [invalid, setInvalid] = createSignal<string>()

  const savedDepth = () => {
    const value = experimental().subagent_depth

    return typeof value === "number" ? String(value) : ""
  }

  const savedIdle = () => {
    const value = experimental().location_idle_timeout

    if (value === false) return "never"

    return typeof value === "string" ? value : ""
  }

  const savedLines = () => {
    const value = values().tool_output
    return isPlainObject(value) && typeof value.max_lines === "number" ? String(value.max_lines) : ""
  }

  const depth = () => depthDraft() ?? savedDepth()
  const idle = () => idleDraft() ?? savedIdle()
  const lines = () => linesDraft() ?? savedLines()

  const write = (key: string, value: unknown) => save.run(["experimental", key], value)

  const saveDepth = () => {
    const text = depth().trim()

    if (text && !/^\d+$/.test(text)) return setInvalid(ctx.t("experimental.depth.invalid"))
    setInvalid(undefined)
    void write("subagent_depth", text ? Number(text) : undefined).then(() => setDepth(undefined))
  }

  const saveIdle = () => {
    const text = idle().trim()

    setInvalid(undefined)
    void write("location_idle_timeout", text === "" ? undefined : text.toLowerCase() === "never" ? false : text).then(
      () => setIdle(undefined),
    )
  }

  const saveLines = () => {
    const text = lines().trim()

    if (text && !/^[1-9]\d*$/.test(text)) return setInvalid(ctx.t("experimental.lines.invalid"))
    setInvalid(undefined)
    void save.run(["tool_output", "max_lines"], text ? Number(text) : undefined).then(() => setLines(undefined))
  }

  const search = (): Search => {
    const value = values().websearch
    if (value === false) return "off"
    if (isPlainObject(value) && typeof value.provider === "string" && SEARCH.includes(value.provider as Search))
      return value.provider as Search
    return "default"
  }

  const setSearch = (choice: Search) =>
    save.run(
      ["websearch"],
      choice === "default" ? undefined : choice === "off" ? false : { provider: choice },
    )

  const warm = () => {
    const value = values().warming
    return value === true || isPlainObject(value)
  }

  return (
    <div class="flex flex-col gap-6">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("experimental.description")}</p>

      <Section title={ctx.t("experimental.section.speed")}>
        <Row title={ctx.t("experimental.warming")} description={ctx.t("experimental.warming.description")}>
          <Switch
            hideLabel
            checked={warm()}
            disabled={props.config.saving()}
            onChange={(checked) => void save.run(["warming"], checked || undefined)}
          >
            {ctx.t("experimental.warming")}
          </Switch>
        </Row>
        <Row title={ctx.t("experimental.websearch")} description={ctx.t("experimental.websearch.description")}>
          <Select
            options={SEARCH}
            current={search()}
            disabled={props.config.saving()}
            label={(item) => ctx.t(`experimental.websearch.${item}`)}
            onSelect={(item) => item && void setSearch(item)}
          />
        </Row>
        <Row title={ctx.t("experimental.background_compaction")} description={ctx.t("experimental.background_compaction.description")}>
          <Switch
            hideLabel
            checked={experimental().background_compaction === true}
            disabled={props.config.saving()}
            onChange={(checked) => void write("background_compaction", checked || undefined)}
          >
            {ctx.t("experimental.background_compaction")}
          </Switch>
        </Row>
        <Row title={ctx.t("experimental.snapshots")} description={ctx.t("experimental.snapshots.description")}>
          <Switch
            hideLabel
            checked={values().snapshots !== false}
            disabled={props.config.saving()}
            onChange={(checked) => void save.run(["snapshots"], checked ? undefined : false)}
          >
            {ctx.t("experimental.snapshots")}
          </Switch>
        </Row>
        <Row title={ctx.t("experimental.media_blob")} description={ctx.t("experimental.media_blob.description")}>
          <Switch
            hideLabel
            checked={experimental().media_blob === true}
            disabled={props.config.saving()}
            onChange={(checked) => void write("media_blob", checked || undefined)}
          >
            {ctx.t("experimental.media_blob")}
          </Switch>
        </Row>
        <Row title={ctx.t("experimental.idle")} description={ctx.t("experimental.idle.description")}>
          <div class="flex items-center gap-2">
            <TextInput value={idle()} placeholder="60 minutes" onInput={(event) => setIdle(event.currentTarget.value)} />
            <Button variant="neutral" disabled={props.config.saving() || idleDraft() === undefined} onClick={saveIdle}>
              {ctx.t("save")}
            </Button>
          </div>
        </Row>
        <Row title={ctx.t("experimental.lines")} description={ctx.t("experimental.lines.description")}>
          <div class="flex items-center gap-2">
            <TextInput numeric value={lines()} placeholder="2000" onInput={(event) => setLines(event.currentTarget.value)} />
            <Button variant="neutral" disabled={props.config.saving() || linesDraft() === undefined} onClick={saveLines}>
              {ctx.t("save")}
            </Button>
          </div>
        </Row>
      </Section>

      <Section title={ctx.t("experimental.section.engine")}>
        <For each={ENGINE}>
          {(key) => (
            <Row title={ctx.t(`experimental.${key}`)} description={ctx.t(`experimental.${key}.description`)}>
              <Switch
                hideLabel
                checked={experimental()[key] === true}
                disabled={props.config.saving()}
                onChange={(checked) => void write(key, checked || undefined)}
              >
                {ctx.t(`experimental.${key}`)}
              </Switch>
            </Row>
          )}
        </For>
        <Row title={ctx.t("experimental.depth")} description={ctx.t("experimental.depth.description")}>
          <div class="flex items-center gap-2">
            <TextInput numeric value={depth()} placeholder="1" onInput={(event) => setDepth(event.currentTarget.value)} />
            <Button variant="neutral" disabled={props.config.saving() || depthDraft() === undefined} onClick={saveDepth}>
              {ctx.t("save")}
            </Button>
          </div>
        </Row>
      </Section>

      <ErrorText message={invalid() ?? save.error()} />
    </div>
  )
}
