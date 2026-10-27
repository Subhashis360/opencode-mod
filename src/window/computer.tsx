import { createSignal, Show } from "solid-js"
import { Button, Switch, TextInput, useExtension } from "./ui"
import { useModSettings } from "./data"
import type definition from "./index"
import { ErrorText, errorMessage, Row } from "./shared"

const COLOR = /^#[0-9a-fA-F]{6}$/

export default function ComputerTab() {
  const ctx = useExtension<typeof definition>()
  const settings = useModSettings()
  const [error, setError] = createSignal<string>()
  // What the user is typing; until they type, the field shows the saved color.
  const [draft, setColor] = createSignal<string>()
  const color = () => draft() ?? settings.query.data?.aurora.color ?? ""

  const save = async (input: Parameters<typeof settings.save>[0]) => {
    setError(undefined)

    try {
      await settings.save(input)
    } catch (cause) {
      setError(ctx.t("save.error", { error: errorMessage(cause) }))
    }
  }

  const aurora = () => settings.query.data?.aurora ?? { enabled: true, background: false }

  const saveColor = (input = color()) => {
    const value = input.trim()

    if (value && !COLOR.test(value)) return setError(ctx.t("agents.color.invalid"))

    const { color: _previous, ...rest } = aurora()
    void save({ aurora: value ? { ...rest, color: value.toLowerCase() } : rest }).then(() => setColor(undefined))
  }

  // The saved color, or none for the default four-color glow.
  const savedColor = () => settings.query.data?.aurora.color
  const swatch = () => (COLOR.test(color().trim()) ? color().trim() : (savedColor() ?? "#22d3ee"))

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("computer.description")}</p>

      <Show
        when={settings.query.data}
        fallback={
          <p class="text-12-regular text-v2-text-text-muted">
            {settings.query.isError ? errorMessage(settings.query.error) : ctx.t("config.loading")}
          </p>
        }
      >
        {(data) => (
          <>
            <Show when={!data().computerSupported}>
              <p class="text-12-regular text-text-warning-base">{ctx.t("computer.unsupported")}</p>
            </Show>
            <div data-component="settings-list">
              <Row title={ctx.t("computer.enable")} description={ctx.t("computer.enable.description")}>
                <Switch
                  hideLabel
                  checked={data().computerUse}
                  disabled={settings.saving() || !data().computerSupported}
                  onChange={(checked) => void save({ computerUse: checked })}
                >
                  {ctx.t("computer.enable")}
                </Switch>
              </Row>
              <Row title={ctx.t("computer.background")} description={ctx.t("computer.background.description")}>
                <Switch
                  hideLabel
                  checked={data().aurora.background}
                  disabled={settings.saving()}
                  onChange={(checked) => void save({ aurora: { ...data().aurora, background: checked } })}
                >
                  {ctx.t("computer.background")}
                </Switch>
              </Row>
              <Row title={ctx.t("computer.aurora")} description={ctx.t("computer.aurora.description")}>
                <Switch
                  hideLabel
                  checked={data().aurora.enabled}
                  disabled={settings.saving()}
                  onChange={(checked) => void save({ aurora: { ...data().aurora, enabled: checked } })}
                >
                  {ctx.t("computer.aurora")}
                </Switch>
              </Row>
              <Row
                title={ctx.t("computer.aurora.color")}
                description={
                  savedColor()
                    ? ctx.t("computer.aurora.color.custom", { color: savedColor() ?? "" })
                    : ctx.t("computer.aurora.color.default")
                }
              >
                <div class="flex items-center gap-2">
                  <Show when={!savedColor() && !draft()}>
                    <span class="ocm-gradient" title={ctx.t("computer.aurora.color.default")} />
                  </Show>
                  <input
                    type="color"
                    class="ocm-swatch"
                    aria-label={ctx.t("computer.aurora.color.pick")}
                    title={ctx.t("computer.aurora.color.pick")}
                    value={swatch()}
                    onInput={(event) => setColor(event.currentTarget.value)}
                  />
                  <TextInput
                    class="ocm-hex"
                    value={color()}
                    placeholder={ctx.t("computer.aurora.color.placeholder")}
                    onInput={(event) => setColor(event.currentTarget.value)}
                  />
                  <Button variant="neutral" disabled={settings.saving() || draft() === undefined} onClick={() => saveColor()}>
                    {ctx.t("save")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={settings.saving() || (!savedColor() && !draft())}
                    onClick={() => saveColor("")}
                  >
                    {ctx.t("computer.aurora.color.reset")}
                  </Button>
                </div>
              </Row>
            </div>
            <p class="text-11-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("computer.safety")}</p>
          </>
        )}
      </Show>

      <ErrorText message={error()} />
    </div>
  )
}
