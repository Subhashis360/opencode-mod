import { createMemo, For, Show } from "solid-js"
import { useExtension } from "./ui"
import { useModUsage } from "./data"
import type definition from "./index"
import { errorMessage, Row } from "./shared"

// OpenCode's free models are served by its own provider. The limit is decided on OpenCode's servers and is not
// published, so this shows what this machine used.
const FREE_PROVIDER = "opencode"

type Usage = { model: { id: string; providerID: string }; steps: number; tokens: { input: number; output: number } }

export default function LimitsTab() {
  const ctx = useExtension<typeof definition>()
  const usage = useModUsage()

  const free = (models: readonly Usage[]) => models.filter((item) => item.model.providerID === FREE_PROVIDER)
  const requests = (models: readonly Usage[]) => free(models).reduce((sum, item) => sum + item.steps, 0)
  const tokens = (models: readonly Usage[]) =>
    free(models).reduce((sum, item) => sum + item.tokens.input + item.tokens.output, 0)

  const today = createMemo(() => usage.data?.[0])

  return (
    <div class="flex flex-col gap-4">
      <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("limits.description")}</p>

      <Show
        when={today()}
        fallback={
          <p class="text-12-regular text-v2-text-text-muted">
            {usage.isError ? errorMessage(usage.error) : ctx.t("config.loading")}
          </p>
        }
      >
        {(day) => (
          <>
            <div data-component="settings-list">
              <Row title={ctx.t("limits.today")} description={ctx.t("limits.today.description")}>
                <span class="text-14-medium">
                  {ctx.t("limits.count", {
                    requests: requests(day().models),
                    tokens: tokens(day().models).toLocaleString(),
                  })}
                </span>
              </Row>
              <For each={free(day().models)}>
                {(item) => (
                  <Row title={item.model.id}>
                    <span class="text-12-regular text-v2-text-text-muted">
                      {ctx.t("limits.count", {
                        requests: item.steps,
                        tokens: (item.tokens.input + item.tokens.output).toLocaleString(),
                      })}
                    </span>
                  </Row>
                )}
              </For>
            </div>

            <h3 class="settings-section-title">{ctx.t("limits.week")}</h3>
            <div data-component="settings-list">
              <For each={usage.data}>
                {(entry) => (
                  <Row
                    title={new Date(entry.day).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  >
                    <span class="text-12-regular text-v2-text-text-muted">
                      {ctx.t("limits.count", {
                        requests: requests(entry.models),
                        tokens: tokens(entry.models).toLocaleString(),
                      })}
                    </span>
                  </Row>
                )}
              </For>
            </div>
          </>
        )}
      </Show>

      <p class="text-11-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("limits.note")}</p>
    </div>
  )
}
