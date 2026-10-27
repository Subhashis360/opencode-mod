import { createMemo, createSignal, For } from "solid-js"
import { Button, Select, useExtension } from "./ui"
import type { ModConfig } from "./data"
import type definition from "./index"
import {
  ACTIONS,
  applyPreset,
  EFFECTS,
  effects,
  parseRules,
  PRESETS,
  setEffect,
  type Effect,
  type Preset,
  type Rule,
} from "./model"
import { ErrorText, Row, useSave } from "./shared"

type Choice = Effect | "unset"

const CHOICES: readonly Choice[] = ["unset", ...EFFECTS]

export default function PermissionsTab(props: { config: ModConfig }) {
  const ctx = useExtension<typeof definition>()
  const save = useSave(props.config)
  const rules = createMemo(() => parseRules(props.config.values().permissions))
  const current = createMemo(() => effects(rules()))
  const [chosen, setChosen] = createSignal<Preset>("balanced")

  const write = (next: Rule[]) => save.run(["permissions"], next.length ? next : undefined)

  const choose = (action: string, choice: Choice) =>
    write(setEffect(rules(), action, choice === "unset" ? undefined : choice))

  const label = (choice: Choice) =>
    choice === "unset" ? ctx.t("permissions.unset") : ctx.t(`permissions.effect.${choice}`)

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("permissions.description")}</p>

      <div data-component="settings-list">
        <Row title={ctx.t("permissions.preset")}>
          <div class="flex items-center gap-2">
            <Select
              options={[...PRESETS]}
              current={chosen()}
              label={(item) => ctx.t(`permissions.preset.${item}`)}
              value={(item) => item}
              onSelect={(item) => item && setChosen(item)}
            />
            <Button
              variant="neutral"
              disabled={props.config.saving()}
              onClick={() => void write(applyPreset(rules(), chosen()))}
            >
              {ctx.t("permissions.apply")}
            </Button>
          </div>
        </Row>
      </div>

      <ErrorText message={save.error()} />

      <div data-component="settings-list">
        <For each={["*", ...ACTIONS]}>
          {(action) => (
            <Row title={action === "*" ? ctx.t("permissions.everything") : action}>
              <Select
                options={[...CHOICES]}
                current={current()[action] ?? "unset"}
                label={label}
                value={(item) => item}
                onSelect={(item) => item && void choose(action, item)}
              />
            </Row>
          )}
        </For>
      </div>
    </div>
  )
}
