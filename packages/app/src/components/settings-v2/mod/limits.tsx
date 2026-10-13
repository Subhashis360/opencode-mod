import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import { SettingsListV2 } from "../parts/list"
import { SettingsRowV2 } from "../parts/row"
import { isFreeModel, summarize } from "./limits-summary"
import { ModTabHeader, Unavailable, useModConfig } from "./shared"

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function SettingsLimitsV2() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const mod = useModConfig()
  const providers = useProviders(() => undefined)

  const [usage, { refetch }] = createResource(
    () => mod.available() || undefined,
    async () => (await serverSDK().client.global.mod.freeTier()).data,
  )

  // Ticks the reset countdown without refetching.
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(tick))

  const opencodeModels = () => providers.all().get("opencode")?.models ?? {}

  const summary = createMemo(() => {
    const data = usage.error ? undefined : usage()
    if (!data) return
    return summarize({
      dayStart: data.dayStart,
      requests: data.requests,
      isFree: (modelID) => isFreeModel(modelID, opencodeModels()[modelID]?.cost),
    })
  })

  const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const number = (value: number) => value.toLocaleString()
  const modelName = (modelID: string) => opencodeModels()[modelID]?.name ?? modelID
  const resetIn = () => {
    const data = usage.error ? undefined : usage()
    if (!data) return ""
    const minutes = Math.max(0, Math.round((data.resetAt - now()) / 60_000))
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  return (
    <>
      <ModTabHeader
        title={language.t("mod.limits.title")}
        description={language.t("mod.limits.description")}
        actions={
          <Show when={mod.available()}>
            <ButtonV2
              size="normal"
              variant="neutral"
              icon="reset"
              disabled={usage.loading}
              onClick={() => {
                setNow(Date.now())
                void refetch()
              }}
            >
              {usage.loading ? language.t("mod.limits.refreshing") : language.t("mod.limits.refresh")}
            </ButtonV2>
          </Show>
        }
      />
      <div class="settings-v2-tab-body">
        <Show when={mod.available()} fallback={<Unavailable />}>
          <Show when={usage.error}>
            <div class="settings-v2-provider-empty">
              {language.t("mod.limits.error", { message: errorText(usage.error) })}
            </div>
          </Show>
          <Show when={!usage.error && usage()}>
            {(data) => (
              <>
                <div class="settings-v2-section">
                  <SettingsListV2>
                    <SettingsRowV2
                      title={language.t("mod.limits.status")}
                      description={language.t("mod.limits.status.description")}
                    >
                      <Show
                        when={summary()?.limitedAt}
                        fallback={<Tag variant="accent">{language.t("mod.limits.status.available")}</Tag>}
                      >
                        {(at) => <Tag>{language.t("mod.limits.status.limited", { time: time(at()) })}</Tag>}
                      </Show>
                    </SettingsRowV2>
                    <SettingsRowV2
                      title={language.t("mod.limits.ip")}
                      description={language.t("mod.limits.ip.description")}
                    >
                      <span class="mod-entry-meta">
                        {data().ip ?? language.t("mod.limits.ip.unknown", { message: data().ipError ?? "" })}
                      </span>
                    </SettingsRowV2>
                    <SettingsRowV2
                      title={language.t("mod.limits.reset")}
                      description={language.t("mod.limits.reset.description", { time: time(data().resetAt) })}
                    >
                      <span class="settings-v2-provider-name">{resetIn()}</span>
                    </SettingsRowV2>
                    <SettingsRowV2
                      title={language.t("mod.limits.today")}
                      description={language.t("mod.limits.today.description")}
                    >
                      <div class="mod-limit-value">
                        <span class="settings-v2-provider-name">
                          {language.t("mod.limits.today.value", {
                            requests: number(summary()?.today.requests ?? 0),
                            tokens: number(summary()?.today.tokens ?? 0),
                          })}
                        </span>
                        <Show when={summary()?.today.failed}>
                          {(failed) => (
                            <span class="mod-entry-meta">
                              {language.t("mod.limits.today.failed", { count: failed() })}
                            </span>
                          )}
                        </Show>
                      </div>
                    </SettingsRowV2>
                    <SettingsRowV2
                      title={language.t("mod.limits.estimate")}
                      description={language.t("mod.limits.estimate.description")}
                    >
                      <span class="mod-entry-meta">
                        <Show when={summary()?.estimate} fallback={language.t("mod.limits.estimate.unknown")}>
                          {(estimate) =>
                            language.t("mod.limits.estimate.value", {
                              requests: number(estimate().requests),
                              day: estimate().day,
                            })
                          }
                        </Show>
                      </span>
                    </SettingsRowV2>
                    <Show when={summary()?.left !== undefined}>
                      <SettingsRowV2
                        title={language.t("mod.limits.left")}
                        description={language.t("mod.limits.left.description")}
                      >
                        <span class="settings-v2-provider-name">
                          {language.t("mod.limits.left.value", { requests: number(summary()?.left ?? 0) })}
                        </span>
                      </SettingsRowV2>
                    </Show>
                  </SettingsListV2>
                  <p class="mod-field-hint">{language.t("mod.limits.updated", { time: time(data().now) })}</p>
                </div>

                <div class="settings-v2-section">
                  <h3 class="settings-v2-section-title">{language.t("mod.limits.models")}</h3>
                  <SettingsListV2>
                    <Show
                      when={(summary()?.models.length ?? 0) > 0}
                      fallback={<div class="settings-v2-provider-empty">{language.t("mod.limits.models.empty")}</div>}
                    >
                      <For each={summary()?.models}>
                        {(model) => (
                          <SettingsRowV2 title={modelName(model.modelID)} description={model.modelID}>
                            <span class="mod-entry-meta">
                              {language.t("mod.limits.models.value", {
                                requests: number(model.requests),
                                tokens: number(model.tokens),
                              })}
                            </span>
                          </SettingsRowV2>
                        )}
                      </For>
                    </Show>
                  </SettingsListV2>
                </div>

                <div class="settings-v2-section">
                  <h3 class="settings-v2-section-title">{language.t("mod.limits.history")}</h3>
                  <SettingsListV2>
                    <For each={summary()?.days}>
                      {(day) => (
                        <SettingsRowV2 title={day.day} description="">
                          <div class="mod-limit-value">
                            <span class="mod-entry-meta">
                              {language.t("mod.limits.history.value", { requests: number(day.requests) })}
                            </span>
                            <Show when={day.beforeLimit !== undefined}>
                              <Tag>{language.t("mod.limits.history.limited")}</Tag>
                            </Show>
                          </div>
                        </SettingsRowV2>
                      )}
                    </For>
                  </SettingsListV2>
                </div>
              </>
            )}
          </Show>
        </Show>
      </div>
    </>
  )
}
