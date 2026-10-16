// OpenCode Mod: scheduled tasks. Each run starts a new session in the task's folder; the desktop
// app keeps running in the tray so tasks fire while its window is closed.
import type { ScheduleRun, ScheduleTask, ScheduleTaskInput, ScheduleTrigger } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useNavigate } from "@solidjs/router"
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { isModBuild } from "@/utils/mod-build"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "../parts/list"
import { SettingsRowV2 } from "../parts/row"
import { DeleteButton, ModTabHeader } from "./shared"
import { draftFrom, ScheduleEditor, WEEKDAYS } from "./schedule-editor"

const MOD_STORE = "opencode.mod"

export function SettingsScheduleV2() {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const navigate = useNavigate()
  const dialog = useDialog()
  const t = (key: string, params?: Record<string, string | number>) =>
    language.t(key as Parameters<typeof language.t>[0], params as never)
  const api = () => serverSdk().client.global.mod
  const [editing, setEditing] = createSignal<{ task?: ScheduleTask; copy?: boolean }>()
  const [history, setHistory] = createSignal<string>()
  const [list, { refetch }] = createResource(
    async () => {
      const result = await api()
        .scheduleList()
        .catch(() => undefined)
      return result?.data ?? { tasks: [], active: [] }
    },
    { initialValue: { tasks: [], active: [] } },
  )
  const [runs, { refetch: refetchRuns }] = createResource(history, async (taskID) => {
    const result = await api().scheduleRuns({ taskID })
    return result.data ?? []
  })

  // Runs start and finish on their own, so keep the list fresh while the tab is open.
  onMount(() => {
    const timer = setInterval(() => {
      void refetch()
      if (history()) void refetchRuns()
    }, 4000)
    onCleanup(() => clearInterval(timer))
  })

  const fail = (err: unknown) =>
    showToast({ title: t("common.requestFailed"), description: err instanceof Error ? err.message : String(err) })
  const act = async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work()
      if (success) showToast({ variant: "success", icon: "circle-check", title: success })
    } catch (err) {
      fail(err)
    }
    void refetch()
    if (history()) void refetchRuns()
  }

  const save = async (input: ScheduleTaskInput) => {
    const current = editing()
    const result =
      current?.task && !current.copy
        ? await api().scheduleUpdate({ id: current.task.id, patch: input })
        : await api().scheduleCreate({ scheduleTaskInput: input })
    const data = result.data
    if (!data) return t("common.requestFailed")
    if (!data.success) return data.error
    setEditing(undefined)
    showToast({ variant: "success", icon: "circle-check", title: t("mod.toast.saved", { name: data.task.name }) })
    void refetch()
    return undefined
  }

  const openSession = (run: ScheduleRun) => {
    if (!run.sessionID) return
    dialog.close()
    navigate(`/${base64Encode(run.directory)}/session/${run.sessionID}`)
  }

  const when = (time?: number | null) => (time ? new Date(time).toLocaleString() : "—")
  const describe = (trigger: ScheduleTrigger) => {
    switch (trigger.kind) {
      case "once":
        return t("mod.schedule.describe.once", { at: when(trigger.at) })
      case "interval":
        return t("mod.schedule.describe.interval", { minutes: trigger.minutes })
      case "daily":
        return t("mod.schedule.describe.daily", { time: trigger.time })
      case "weekly":
        return t("mod.schedule.describe.weekly", {
          time: trigger.time,
          days: trigger.days.map((day) => t(`mod.schedule.day.${WEEKDAYS[day]}`)).join(", "),
        })
      case "monthly":
        return t("mod.schedule.describe.monthly", { day: trigger.day, time: trigger.time })
      case "cron":
        return t("mod.schedule.describe.cron", { expression: trigger.expression })
    }
  }
  const folder = (directory: string) => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory

  return (
    <>
      <ModTabHeader
        title={t("mod.schedule.title")}
        description={t("mod.schedule.description")}
        actions={
          <Show when={!editing()}>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => setEditing({})}>
              {t("mod.schedule.new")}
            </ButtonV2>
          </Show>
        }
      />
      <div class="settings-v2-tab-body">
        <Show when={editing()}>
          {(state) => (
            <ScheduleEditor
              title={state().task && !state().copy ? state().task!.name : t("mod.schedule.new")}
              initial={(() => {
                const draft = draftFrom(state().task)
                return state().copy ? { ...draft, name: `${draft.name} (copy)` } : draft
              })()}
              onSave={save}
              onCancel={() => setEditing(undefined)}
            />
          )}
        </Show>

        <div class="settings-v2-section">
          <SettingsListV2>
            <Show
              when={list().tasks.length > 0}
              fallback={<div class="settings-v2-provider-empty">{t("mod.schedule.empty")}</div>}
            >
              <For each={list().tasks}>
                {(task) => {
                  const running = () => list().active.includes(task.id)
                  return (
                    <div class="mod-schedule-task">
                      <div class="settings-v2-provider-row">
                        <div class="settings-v2-provider-lead">
                          <div class="settings-v2-provider-copy">
                            <div class="settings-v2-provider-main">
                              <span class="settings-v2-provider-name">{task.name}</span>
                              <Tag>{describe(task.trigger)}</Tag>
                              <Show when={running()}>
                                <Tag>{t("mod.schedule.running")}</Tag>
                              </Show>
                              <Show when={!task.enabled}>
                                <Tag>{t("mod.schedule.paused")}</Tag>
                              </Show>
                            </div>
                            <p class="settings-v2-provider-description">
                              {t("mod.schedule.summary", {
                                folder: folder(task.directory),
                                next: task.enabled ? when(task.nextRun) : "—",
                                last: task.lastRun ? t(`mod.schedule.status.${task.lastRun.status}`) : "—",
                              })}
                            </p>
                          </div>
                        </div>
                        <div class="settings-v2-provider-actions">
                          <Switch
                            hideLabel
                            checked={task.enabled}
                            onChange={(enabled: boolean) =>
                              void act(() =>
                                api().scheduleUpdate({ id: task.id, patch: { enabled } }, { throwOnError: true }),
                              )
                            }
                          >
                            {t("mod.schedule.enabled")}
                          </Switch>
                          <Show
                            when={running()}
                            fallback={
                              <ButtonV2
                                size="normal"
                                variant="ghost-muted"
                                onClick={() =>
                                  void act(
                                    () => api().scheduleRun({ id: task.id }, { throwOnError: true }),
                                    t("mod.schedule.toast.started", { name: task.name }),
                                  )
                                }
                              >
                                {t("mod.schedule.runNow")}
                              </ButtonV2>
                            }
                          >
                            <ButtonV2
                              size="normal"
                              variant="ghost-muted"
                              onClick={() =>
                                void act(() => api().scheduleCancel({ id: task.id }, { throwOnError: true }))
                              }
                            >
                              {t("mod.schedule.stop")}
                            </ButtonV2>
                          </Show>
                          <ButtonV2
                            size="normal"
                            variant="ghost-muted"
                            onClick={() => setHistory((current) => (current === task.id ? undefined : task.id))}
                          >
                            {t("mod.schedule.history")}
                          </ButtonV2>
                          <ButtonV2 size="normal" variant="ghost-muted" onClick={() => setEditing({ task })}>
                            {t("common.edit")}
                          </ButtonV2>
                          <ButtonV2
                            size="normal"
                            variant="ghost-muted"
                            onClick={() => setEditing({ task, copy: true })}
                          >
                            {t("mod.schedule.duplicate")}
                          </ButtonV2>
                          <DeleteButton
                            onConfirm={() =>
                              void act(
                                () => api().scheduleRemove({ id: task.id }, { throwOnError: true }),
                                t("mod.toast.deleted", { name: task.name }),
                              )
                            }
                          />
                        </div>
                      </div>
                      <Show when={history() === task.id}>
                        <div class="mod-schedule-history">
                          <Show
                            when={(runs() ?? []).length > 0}
                            fallback={<span class="mod-field-hint">{t("mod.schedule.noRuns")}</span>}
                          >
                            <For each={runs()}>
                              {(run) => (
                                <div class="mod-schedule-run" data-status={run.status}>
                                  <span>{when(run.started)}</span>
                                  <Tag>{t(`mod.schedule.status.${run.status}`)}</Tag>
                                  <Show when={run.reason !== "schedule"}>
                                    <span class="mod-field-hint">{t(`mod.schedule.reason.${run.reason}`)}</span>
                                  </Show>
                                  <Show when={run.finished}>
                                    <span class="mod-field-hint">
                                      {Math.max(1, Math.round(((run.finished ?? 0) - run.started) / 1000))}s
                                    </span>
                                  </Show>
                                  <Show when={run.error}>
                                    <span class="mod-field-error">{run.error}</span>
                                  </Show>
                                  <Show when={run.sessionID}>
                                    <ButtonV2 size="normal" variant="ghost-muted" onClick={() => openSession(run)}>
                                      {t("mod.schedule.openSession")}
                                    </ButtonV2>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <BackgroundSettings />
      </div>
    </>
  )
}

// Desktop only: these keys are read by the main process (desktop/src/main/background.ts).
function BackgroundSettings() {
  const language = useLanguage()
  const platform = usePlatform()
  const storage = isModBuild && platform.platform === "desktop" ? platform.storage?.(MOD_STORE) : undefined
  const [values, setValues] = createSignal({ background: true, login: false })
  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])

  onMount(async () => {
    if (!storage) return
    const [background, login] = await Promise.all([
      Promise.resolve(storage.getItem("backgroundMode")).catch(() => null),
      Promise.resolve(storage.getItem("openAtLogin")).catch(() => null),
    ])
    setValues({ background: background !== "false", login: login === "true" })
  })

  const set = (key: "backgroundMode" | "openAtLogin", value: boolean) => {
    setValues((current) => ({ ...current, [key === "backgroundMode" ? "background" : "login"]: value }))
    void Promise.resolve(storage?.setItem(key, String(value)))
  }

  return (
    <Show when={storage}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{t("mod.schedule.background.title")}</h3>
        <SettingsListV2>
          <SettingsRowV2 title={t("mod.schedule.background.tray")} description={t("mod.schedule.background.tray.hint")}>
            <Switch checked={values().background} onChange={(value: boolean) => set("backgroundMode", value)} />
          </SettingsRowV2>
          <SettingsRowV2
            title={t("mod.schedule.background.login")}
            description={t("mod.schedule.background.login.hint")}
          >
            <Switch checked={values().login} onChange={(value: boolean) => set("openAtLogin", value)} />
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </Show>
  )
}
