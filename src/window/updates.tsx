import { createSignal, Show } from "solid-js"
import { Updater, type Status } from "../update/contract"
import type definition from "./index"
import { ErrorText, errorMessage, Row } from "./shared"
import { Button, Switch, useExtension } from "./ui"

const short = (sha: string | undefined) => sha?.slice(0, 7) ?? ""

/** Updates from GitHub: the automatic switch, Check for updates and Update now. The desktop main process does the work. */
export default function UpdatesTab() {
  const ctx = useExtension<typeof definition>()
  const updater = ctx.main(Updater)
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const status = () => updater.state()
  const busy = () => pending() || status()?.phase === "checking" || status()?.phase === "installing"

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    setPending(true)
    try {
      await fn()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  const describe = (value: Status) => {
    switch (value.phase) {
      case "idle":
        return ctx.t("update.idle")
      case "checking":
        return ctx.t("update.checking")
      case "installing":
        return ctx.t("update.installing")
      case "current":
        return ctx.t("update.current", { version: short(value.installed ?? value.latest?.sha) })
      case "installed":
        return ctx.t("update.installed", { version: short(value.installed) })
      case "available":
        return value.behind
          ? ctx.t("update.available.count", { count: value.behind })
          : ctx.t("update.available")
      case "diverged":
        return ctx.t("update.diverged")
      case "error":
        return ctx.t("update.error")
    }
  }

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("update.description")}</p>

      <Show when={status()} fallback={<p class="text-12-regular text-v2-text-text-muted">{ctx.t("update.loading")}</p>}>
        {(value) => (
          <div data-component="settings-list">
            <Row title={ctx.t("update.auto")} description={ctx.t("update.auto.description")}>
              <Switch
                hideLabel
                checked={value().autoUpdate}
                disabled={pending()}
                onChange={(on) => void act(() => updater.setAutoUpdate(on))}
              >
                {ctx.t("update.auto")}
              </Switch>
            </Row>

            <Row
              title={describe(value())}
              description={[
                value().latest
                  ? ctx.t("update.latest", {
                      version: short(value().latest!.sha),
                      message: value().latest!.message,
                      date: new Date(value().latest!.date).toLocaleDateString(),
                    })
                  : "",
                value().checked
                  ? ctx.t("update.checked", { time: new Date(value().checked!).toLocaleTimeString() })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <div class="flex items-center gap-2">
                <Button variant="neutral" disabled={busy()} onClick={() => void act(() => updater.check())}>
                  {value().phase === "checking" ? ctx.t("update.checking.button") : ctx.t("update.check")}
                </Button>
                <Show when={value().phase === "available" || value().phase === "installing"}>
                  <Button variant="submit" disabled={busy()} onClick={() => void act(() => updater.install())}>
                    {value().phase === "installing" ? ctx.t("update.installing.button") : ctx.t("update.install")}
                  </Button>
                </Show>
              </div>
            </Row>

            <Show when={value().restartNeeded}>
              <Row title={ctx.t("update.restart.title")} description={ctx.t("update.restart.description")}>
                <Button variant="submit" onClick={() => void act(() => updater.restart())}>
                  {ctx.t("update.restart")}
                </Button>
              </Row>
            </Show>

            <Show when={value().folder}>
              <Row
                title={ctx.t("update.folder")}
                description={`${value().folder} · ${value().method === "git" ? ctx.t("update.method.git") : ctx.t("update.method.download")}`}
              />
            </Show>
          </div>
        )}
      </Show>

      <ErrorText message={error() ?? (status()?.phase === "error" ? status()?.error : undefined)} />
    </div>
  )
}
