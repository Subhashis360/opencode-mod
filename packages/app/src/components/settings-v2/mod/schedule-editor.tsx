import type { ScheduleTask, ScheduleTaskInput, ScheduleTrigger } from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { ModelSelect, ModField, revealEditor } from "./shared"

export type Kind = ScheduleTrigger["kind"]
export const KINDS: Kind[] = ["daily", "weekly", "monthly", "interval", "once", "cron"]
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
const MODES = ["ask", "deny", "allow"] as const
const BUILT_IN_AGENTS = ["", "build", "plan"]

type Draft = {
  name: string
  prompt: string
  directory: string
  kind: Kind
  at: string
  minutes: string
  time: string
  days: number[]
  day: string
  cron: string
  agent: string
  model: string
  permission: (typeof MODES)[number]
  catchUp: boolean
  notify: boolean
  timeout: string
}

const pad = (value: number) => String(value).padStart(2, "0")
const localInput = (time: number) => {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function draftFrom(task?: ScheduleTask, directory = ""): Draft {
  const trigger = task?.trigger
  return {
    name: task?.name ?? "",
    prompt: task?.prompt ?? "",
    directory: task?.directory ?? directory,
    kind: trigger?.kind ?? "daily",
    at: localInput(trigger?.kind === "once" ? trigger.at : Date.now() + 60 * 60_000),
    minutes: String(trigger?.kind === "interval" ? trigger.minutes : 60),
    time: trigger && "time" in trigger ? trigger.time : "09:00",
    days: trigger?.kind === "weekly" ? [...trigger.days] : [1, 2, 3, 4, 5],
    day: String(trigger?.kind === "monthly" ? trigger.day : 1),
    cron: trigger?.kind === "cron" ? trigger.expression : "0 9 * * 1-5",
    agent: task?.agent ?? "",
    model: task?.model ? `${task.model.providerID}/${task.model.modelID}` : "",
    permission: task?.permission ?? "ask",
    catchUp: task?.catchUp ?? false,
    notify: task?.notify ?? true,
    timeout: String(task?.timeoutMinutes ?? 60),
  }
}

function toInput(draft: Draft): ScheduleTaskInput {
  const trigger: ScheduleTrigger =
    draft.kind === "once"
      ? { kind: "once", at: new Date(draft.at).getTime() }
      : draft.kind === "interval"
        ? { kind: "interval", minutes: Number(draft.minutes) }
        : draft.kind === "daily"
          ? { kind: "daily", time: draft.time }
          : draft.kind === "weekly"
            ? { kind: "weekly", time: draft.time, days: draft.days }
            : draft.kind === "monthly"
              ? { kind: "monthly", time: draft.time, day: Number(draft.day) }
              : { kind: "cron", expression: draft.cron.trim() }
  const [providerID, ...model] = draft.model.split("/")
  return {
    name: draft.name,
    prompt: draft.prompt,
    directory: draft.directory.trim(),
    trigger,
    agent: draft.agent || undefined,
    model: draft.model ? { providerID, modelID: model.join("/") } : undefined,
    permission: draft.permission,
    catchUp: draft.catchUp,
    notify: draft.notify,
    timeoutMinutes: Number(draft.timeout) || 60,
  }
}

export function ScheduleEditor(props: {
  title: string
  initial: Draft
  onSave: (input: ScheduleTaskInput) => Promise<string | undefined>
  onCancel: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSync = useServerSync()
  const [draft, setDraft] = createStore<Draft>({ ...props.initial, days: [...props.initial.days] })
  const [error, setError] = createSignal<string>()
  const [saving, setSaving] = createSignal(false)
  const projects = createMemo(() => [...new Set(serverSync().data.project.map((project) => project.worktree))])
  const agents = createMemo(() => [
    ...new Set([...BUILT_IN_AGENTS, ...Object.keys(serverSync().data.config.agent ?? {})]),
  ])
  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])

  const browse = async () => {
    if (platform.platform !== "desktop") return
    const picked = await platform.openDirectoryPickerDialog({ title: t("mod.schedule.field.directory") })
    const directory = Array.isArray(picked) ? picked[0] : picked
    if (directory) setDraft("directory", directory)
  }

  const save = async () => {
    setSaving(true)
    const problem = await props.onSave(toInput(draft))
    setSaving(false)
    setError(problem)
  }

  return (
    <form
      ref={revealEditor}
      class="mod-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <h3 class="mod-editor-title">{props.title}</h3>
      <div class="mod-editor-grid">
        <ModField label={t("mod.field.name")}>
          <TextInputV2 value={draft.name} onInput={(event) => setDraft("name", event.currentTarget.value)} />
        </ModField>
        <ModField label={t("mod.schedule.field.directory")} hint={t("mod.schedule.field.directory.hint")}>
          <div class="mod-schedule-row">
            <TextInputV2
              value={draft.directory}
              list="mod-schedule-projects"
              onInput={(event) => setDraft("directory", event.currentTarget.value)}
            />
            <datalist id="mod-schedule-projects">
              <For each={projects()}>{(project) => <option value={project} />}</For>
            </datalist>
            <Show when={platform.platform === "desktop"}>
              <ButtonV2 type="button" size="normal" variant="neutral" onClick={() => void browse()}>
                {t("mod.schedule.browse")}
              </ButtonV2>
            </Show>
          </div>
        </ModField>
      </div>
      <ModField label={t("mod.schedule.field.prompt")} hint={t("mod.schedule.field.prompt.hint")}>
        <TextareaV2 rows={5} value={draft.prompt} onInput={(event) => setDraft("prompt", event.currentTarget.value)} />
      </ModField>
      <div class="mod-editor-grid">
        <ModField label={t("mod.schedule.field.repeat")}>
          <SelectV2
            appearance="base"
            options={KINDS}
            current={draft.kind}
            gutter={6}
            label={(kind) => t(`mod.schedule.kind.${kind}`)}
            onSelect={(kind) => kind && setDraft("kind", kind)}
          />
        </ModField>
        <Show when={draft.kind === "once"}>
          <ModField label={t("mod.schedule.field.at")}>
            <TextInputV2
              type="datetime-local"
              value={draft.at}
              onInput={(event) => setDraft("at", event.currentTarget.value)}
            />
          </ModField>
        </Show>
        <Show when={draft.kind === "interval"}>
          <ModField label={t("mod.schedule.field.minutes")}>
            <TextInputV2
              type="number"
              min="1"
              value={draft.minutes}
              onInput={(event) => setDraft("minutes", event.currentTarget.value)}
            />
          </ModField>
        </Show>
        <Show when={draft.kind === "daily" || draft.kind === "weekly" || draft.kind === "monthly"}>
          <ModField label={t("mod.schedule.field.time")}>
            <TextInputV2
              type="time"
              value={draft.time}
              onInput={(event) => setDraft("time", event.currentTarget.value)}
            />
          </ModField>
        </Show>
        <Show when={draft.kind === "cron"}>
          <ModField label={t("mod.schedule.field.cron")} hint={t("mod.schedule.field.cron.hint")}>
            <TextInputV2 value={draft.cron} onInput={(event) => setDraft("cron", event.currentTarget.value)} />
          </ModField>
        </Show>
      </div>
      <Show when={draft.kind === "weekly"}>
        <ModField label={t("mod.schedule.field.days")}>
          <div class="mod-schedule-days">
            <For each={WEEKDAYS}>
              {(day, index) => (
                <ButtonV2
                  type="button"
                  size="normal"
                  variant={draft.days.includes(index()) ? "contrast" : "ghost-muted"}
                  onClick={() =>
                    setDraft("days", (days) =>
                      days.includes(index()) ? days.filter((item) => item !== index()) : [...days, index()].toSorted(),
                    )
                  }
                >
                  {t(`mod.schedule.day.${day}`)}
                </ButtonV2>
              )}
            </For>
          </div>
        </ModField>
      </Show>
      <Show when={draft.kind === "monthly"}>
        <ModField label={t("mod.schedule.field.day")} hint={t("mod.schedule.field.day.hint")}>
          <TextInputV2
            type="number"
            min="1"
            max="31"
            value={draft.day}
            onInput={(event) => setDraft("day", event.currentTarget.value)}
          />
        </ModField>
      </Show>
      <div class="mod-editor-grid">
        <ModField label={t("mod.commands.field.agent")}>
          <SelectV2
            appearance="base"
            options={agents()}
            current={draft.agent}
            gutter={6}
            value={(agent) => agent || "default"}
            label={(agent) => agent || t("mod.commands.agent.default")}
            onSelect={(agent) => agent !== null && setDraft("agent", agent)}
          />
        </ModField>
        <ModField label={t("mod.field.model")}>
          <ModelSelect value={draft.model} onChange={(model) => setDraft("model", model)} />
        </ModField>
      </div>
      <div class="mod-editor-grid">
        <ModField
          label={t("mod.schedule.field.permission")}
          hint={t(`mod.schedule.permission.${draft.permission}.hint`)}
        >
          <SelectV2
            appearance="base"
            options={[...MODES]}
            current={draft.permission}
            gutter={6}
            label={(mode) => t(`mod.schedule.permission.${mode}`)}
            onSelect={(mode) => mode && setDraft("permission", mode)}
          />
        </ModField>
        <ModField label={t("mod.schedule.field.timeout")}>
          <TextInputV2
            type="number"
            min="1"
            value={draft.timeout}
            onInput={(event) => setDraft("timeout", event.currentTarget.value)}
          />
        </ModField>
      </div>
      <div class="mod-editor-grid">
        <ModField label={t("mod.schedule.field.catchUp")} hint={t("mod.schedule.field.catchUp.hint")}>
          <Switch hideLabel checked={draft.catchUp} onChange={(value: boolean) => setDraft("catchUp", value)}>
            {t("mod.schedule.field.catchUp")}
          </Switch>
        </ModField>
        <ModField label={t("mod.schedule.field.notify")}>
          <Switch hideLabel checked={draft.notify} onChange={(value: boolean) => setDraft("notify", value)}>
            {t("mod.schedule.field.notify")}
          </Switch>
        </ModField>
      </div>
      <Show when={error()}>{(message) => <p class="mod-field-error">{message()}</p>}</Show>
      <div class="mod-editor-actions">
        <ButtonV2 type="button" size="normal" variant="ghost" onClick={props.onCancel}>
          {t("common.cancel")}
        </ButtonV2>
        <ButtonV2 type="submit" size="normal" variant="contrast" disabled={saving()}>
          {saving() ? t("common.saving") : t("common.save")}
        </ButtonV2>
      </div>
    </form>
  )
}
