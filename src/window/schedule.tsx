import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Mod } from "../server/rpc"
import { Schedule } from "../server/schedule/schedule"
import { Button, Select, Switch, TextInput, Textarea, useExtension } from "./ui"
import { useModSchedule, useModSettings } from "./data"
import type definition from "./index"
import { draftFrom, KINDS, MODES, toggleDay, toInput, WEEKDAYS, type Draft } from "./schedule-model"
import { EditorCard, ErrorText, errorMessage, Field, Row } from "./shared"

type Task = Schedule.Task

export default function ScheduleTab() {
  const ctx = useExtension<typeof definition>()
  const schedule = useModSchedule()
  const settings = useModSettings()
  const [draft, setDraft] = createStore<Draft>(draftFrom())
  const [open, setOpen] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [history, setHistory] = createSignal<{ taskID: string; runs: readonly Schedule.Run[] }>()
  const [confirming, setConfirming] = createSignal<string>()

  // Every action reports its error under the list instead of failing quietly.
  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    setBusy(true)

    try {
      await fn()

      return true
    } catch (cause) {
      setError(errorMessage(cause))

      return false
    } finally {
      setBusy(false)
    }
  }

  const edit = (task?: Task) => {
    setError(undefined)
    setDraft(draftFrom(task, schedule.projects()[0] ?? ""))
    setOpen(true)
  }

  const save = async () => {
    const input = toInput(draft)
    const id = draft.id

    const done = await act(() =>
      id ? schedule.update(id, input satisfies Mod.ScheduleTaskPatch) : schedule.create(input),
    )

    if (done) setOpen(false)
  }

  const showHistory = (taskID: string) =>
    act(async () => {
      if (history()?.taskID === taskID) return setHistory(undefined)

      setHistory({ taskID, runs: await schedule.runs(taskID) })
    })

  const when = (time: number | null | undefined) => (time ? new Date(time).toLocaleString() : ctx.t("schedule.never"))

  const describe = (task: Task) => {
    const parts = [
      Schedule.describe(task.trigger),
      task.enabled ? `${ctx.t("schedule.next")} ${when(task.nextRun)}` : ctx.t("schedule.paused"),
    ]

    if (task.lastRun) parts.push(`${ctx.t("schedule.last")} ${ctx.t(`schedule.status.${task.lastRun.status}`)}`)

    return parts.join(" · ")
  }

  const running = (task: Task) => task.lastRun?.status === "running"

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-12-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("schedule.description")}</p>
        <Button variant="neutral" onClick={() => edit()}>
          {ctx.t("new")}
        </Button>
      </div>

      <Show when={open()}>
        <EditorCard>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={ctx.t("name")}>
              <TextInput value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("schedule.folder")} hint={ctx.t("schedule.folder.hint")}>
              <div class="flex items-center gap-2">
                <TextInput
                  value={draft.directory}
                  onInput={(event) => setDraft("directory", event.currentTarget.value)}
                />
                <Show when={schedule.projects().length}>
                  <Select
                    options={schedule.projects()}
                    placeholder={ctx.t("schedule.folder.pick")}
                    label={(item) => item}
                    value={(item) => item}
                    onSelect={(item) => item && setDraft("directory", item)}
                  />
                </Show>
              </div>
            </Field>
          </div>

          <Field label={ctx.t("schedule.prompt")} hint={ctx.t("schedule.prompt.hint")}>
            <Textarea
              rows={4}
              value={draft.prompt}
              onInput={(event) => setDraft("prompt", event.currentTarget.value)}
            />
          </Field>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label={ctx.t("schedule.when")}>
              <Select
                options={[...KINDS]}
                current={draft.kind}
                label={(kind) => ctx.t(`schedule.kind.${kind}`)}
                value={(kind) => kind}
                onSelect={(kind) => kind && setDraft("kind", kind)}
              />
            </Field>
            <Show when={draft.kind === "daily" || draft.kind === "weekly" || draft.kind === "monthly"}>
              <Field label={ctx.t("schedule.time")}>
                <TextInput
                  type="time"
                  value={draft.time}
                  onInput={(event) => setDraft("time", event.currentTarget.value)}
                />
              </Field>
            </Show>
            <Show when={draft.kind === "monthly"}>
              <Field label={ctx.t("schedule.day")} hint={ctx.t("schedule.day.hint")}>
                <TextInput numeric value={draft.day} onInput={(event) => setDraft("day", event.currentTarget.value)} />
              </Field>
            </Show>
            <Show when={draft.kind === "interval"}>
              <Field label={ctx.t("schedule.minutes")}>
                <TextInput
                  numeric
                  value={draft.minutes}
                  onInput={(event) => setDraft("minutes", event.currentTarget.value)}
                />
              </Field>
            </Show>
            <Show when={draft.kind === "once"}>
              <Field label={ctx.t("schedule.at")}>
                <TextInput
                  type="datetime-local"
                  value={draft.at}
                  onInput={(event) => setDraft("at", event.currentTarget.value)}
                />
              </Field>
            </Show>
            <Show when={draft.kind === "cron"}>
              <Field label={ctx.t("schedule.cron")} hint={ctx.t("schedule.cron.hint")}>
                <TextInput value={draft.cron} onInput={(event) => setDraft("cron", event.currentTarget.value)} />
              </Field>
            </Show>
          </div>

          <Show when={draft.kind === "weekly"}>
            <div class="flex flex-wrap gap-2" role="group" aria-label={ctx.t("schedule.days")}>
              <For each={WEEKDAYS}>
                {(name, index) => (
                  <Button
                    variant={draft.days.includes(index()) ? "contrast" : "ghost"}
                    aria-pressed={draft.days.includes(index())}
                    onClick={() => setDraft("days", toggleDay(draft.days, index()))}
                  >
                    {ctx.t(`schedule.day.${name}`)}
                  </Button>
                )}
              </For>
            </div>
          </Show>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label={ctx.t("commands.agent")} hint={ctx.t("commands.agent.placeholder")}>
              <TextInput value={draft.agent} onInput={(event) => setDraft("agent", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("model")} hint={ctx.t("model.placeholder")}>
              <TextInput value={draft.model} onInput={(event) => setDraft("model", event.currentTarget.value)} />
            </Field>
            <Field label={ctx.t("schedule.timeout")}>
              <TextInput
                numeric
                value={draft.timeout}
                onInput={(event) => setDraft("timeout", event.currentTarget.value)}
              />
            </Field>
          </div>

          <Field label={ctx.t("schedule.permission")} hint={ctx.t(`schedule.permission.${draft.permission}.hint`)}>
            <Select
              options={[...MODES]}
              current={draft.permission}
              label={(mode) => ctx.t(`schedule.permission.${mode}`)}
              value={(mode) => mode}
              onSelect={(mode) => mode && setDraft("permission", mode)}
            />
          </Field>

          <div class="flex flex-wrap gap-6">
            <Switch checked={draft.catchUp} onChange={(checked) => setDraft("catchUp", checked)}>
              {ctx.t("schedule.catchUp")}
            </Switch>
            <Switch checked={draft.notify} onChange={(checked) => setDraft("notify", checked)}>
              {ctx.t("schedule.notify")}
            </Switch>
          </div>

          <ErrorText message={error()} />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {ctx.t("cancel")}
            </Button>
            <Button variant="submit" disabled={busy()} onClick={() => void save()}>
              {ctx.t("save")}
            </Button>
          </div>
        </EditorCard>
      </Show>

      <Show when={!open()}>
        <ErrorText message={error()} />
      </Show>

      <Show when={settings.query.data}>
        {(data) => (
          <div data-component="settings-list">
            <Row title={ctx.t("schedule.background")} description={ctx.t("schedule.background.description")}>
              <Switch
                hideLabel
                checked={data().stayInTray}
                disabled={settings.saving()}
                onChange={(stayInTray) => void act(() => settings.save({ stayInTray }))}
              >
                {ctx.t("schedule.background")}
              </Switch>
            </Row>
            <Row title={ctx.t("schedule.login")} description={ctx.t("schedule.login.description")}>
              <Switch
                hideLabel
                checked={data().openAtLogin}
                disabled={settings.saving()}
                onChange={(openAtLogin) => void act(() => settings.save({ openAtLogin }))}
              >
                {ctx.t("schedule.login")}
              </Switch>
            </Row>
          </div>
        )}
      </Show>

      <div data-component="settings-list">
        <Show
          when={schedule.tasks.data?.length}
          fallback={<Row title={schedule.tasks.isPending ? ctx.t("config.loading") : ctx.t("schedule.empty")} />}
        >
          <For each={schedule.tasks.data}>
            {(task) => (
              <>
                <Row title={task.name} description={describe(task)}>
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <Show
                      when={running(task)}
                      fallback={
                        <Button variant="ghost" disabled={busy()} onClick={() => void act(() => schedule.run(task.id))}>
                          {ctx.t("schedule.run")}
                        </Button>
                      }
                    >
                      <Button variant="ghost" disabled={busy()} onClick={() => void act(() => schedule.stop(task.id))}>
                        {ctx.t("schedule.stop")}
                      </Button>
                    </Show>
                    <Switch
                      hideLabel
                      checked={task.enabled}
                      disabled={busy()}
                      onChange={(enabled) => void act(() => schedule.update(task.id, { enabled }))}
                    >
                      {ctx.t("schedule.enabled")}
                    </Switch>
                    <Button variant="ghost" onClick={() => void showHistory(task.id)}>
                      {ctx.t("schedule.history")}
                    </Button>
                    <Button variant="ghost" onClick={() => edit(task)}>
                      {ctx.t("edit")}
                    </Button>
                    <Show
                      when={confirming() === task.id}
                      fallback={
                        <Button variant="ghost" onClick={() => setConfirming(task.id)}>
                          {ctx.t("delete")}
                        </Button>
                      }
                    >
                      <Button variant="ghost" onClick={() => setConfirming(undefined)}>
                        {ctx.t("cancel")}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => void act(() => schedule.remove(task.id)).finally(() => setConfirming(undefined))}
                      >
                        {ctx.t("delete.confirm")}
                      </Button>
                    </Show>
                  </div>
                </Row>
                <Show when={history()?.taskID === task.id}>
                  <div class="flex flex-col gap-1 px-4 pb-3">
                    <Show
                      when={history()?.runs.length}
                      fallback={<span class="text-12-regular text-v2-text-text-muted">{ctx.t("schedule.noRuns")}</span>}
                    >
                      <For each={history()?.runs}>
                        {(run) => (
                          <span class="text-12-regular text-v2-text-text-base">
                            {new Date(run.started).toLocaleString()} · {ctx.t(`schedule.status.${run.status}`)}
                            {run.error ? ` · ${run.error}` : ""}
                          </span>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </For>
        </Show>
      </div>

      <p class="text-11-regular text-v2-text-text-muted max-w-[60ch]">{ctx.t("schedule.footer")}</p>
    </div>
  )
}
