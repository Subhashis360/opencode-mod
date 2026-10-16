import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { isModBuild } from "@/utils/mod-build"
import { SettingsListV2 } from "../parts/list"
import { SettingsRowV2 } from "../parts/row"
import { ModTabHeader } from "./shared"

// The desktop main process reads the same store and key (desktop/src/main/mod-flags.ts) and passes
// the switches to the local server's environment when it starts.
const MOD_STORE = "opencode.mod"
const FLAGS_KEY = "experimentalFlags"

const SECTIONS = [
  {
    title: "mod.experimental.section.tools",
    flags: [
      { key: "OPENCODE_EXPERIMENTAL_CODE_MODE", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_LSP_TOOL", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_COMPUTER_USE", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_PLAN_MODE", kind: "toggle" },
      { key: "OPENCODE_ENABLE_EXA", kind: "toggle" },
      { key: "OPENCODE_ENABLE_PARALLEL", kind: "toggle" },
    ],
  },
  {
    title: "mod.experimental.section.models",
    flags: [
      { key: "OPENCODE_ENABLE_EXPERIMENTAL_MODELS", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_NATIVE_LLM", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_WEBSOCKETS", kind: "toggle" },
    ],
  },
  {
    title: "mod.experimental.section.workspace",
    flags: [
      { key: "OPENCODE_EXPERIMENTAL_WORKSPACES", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_FILEWATCHER", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_OXFMT", kind: "toggle" },
      { key: "OPENCODE_EXPERIMENTAL_LSP_TY", kind: "toggle" },
    ],
  },
  {
    title: "mod.experimental.section.limits",
    flags: [
      { key: "OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS", kind: "number" },
      { key: "OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX", kind: "number" },
    ],
  },
] as const

const serialize = (flags: Record<string, string>) =>
  JSON.stringify(Object.fromEntries(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b))))

// What the running server was started with: the stored flags as first read in this window.
let applied: string | undefined

export function SettingsExperimentalV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const storage = isModBuild && platform.platform === "desktop" ? platform.storage?.(MOD_STORE) : undefined
  const [flags, setFlags] = createSignal<Record<string, string>>({})
  const [loaded, setLoaded] = createSignal(false)

  onMount(async () => {
    if (!storage) return
    const raw = await Promise.resolve(storage.getItem(FLAGS_KEY)).catch(() => null)
    let parsed: Record<string, string> = {}
    try {
      const value: unknown = raw ? JSON.parse(raw) : {}
      if (value && typeof value === "object" && !Array.isArray(value))
        parsed = Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
    } catch {}
    setFlags(parsed)
    applied ??= serialize(parsed)
    setLoaded(true)
  })

  const restartNeeded = createMemo(() => loaded() && serialize(flags()) !== applied)

  const set = (key: string, value: string | undefined) => {
    const next = { ...flags() }
    if (value === undefined) delete next[key]
    else next[key] = value
    setFlags(next)
    void Promise.resolve(storage?.setItem(FLAGS_KEY, JSON.stringify(next)))
  }

  const setNumber = (key: string, text: string) => {
    const value = Number(text.trim())
    set(key, text.trim() && Number.isInteger(value) && value > 0 ? String(value) : undefined)
  }

  return (
    <>
      <ModTabHeader
        title={language.t("mod.experimental.title")}
        description={language.t("mod.experimental.description")}
      />
      <div class="settings-v2-tab-body">
        <Show
          when={storage}
          fallback={<div class="settings-v2-provider-empty">{language.t("mod.experimental.desktopOnly")}</div>}
        >
          <Show when={restartNeeded()}>
            <div class="mod-restart-banner">
              <span>{language.t("mod.experimental.restartNeeded")}</span>
              <ButtonV2 size="normal" variant="contrast" onClick={() => void platform.restart()}>
                {language.t("mod.experimental.restart")}
              </ButtonV2>
            </div>
          </Show>
          <For each={SECTIONS}>
            {(section) => (
              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">{language.t(section.title)}</h3>
                <SettingsListV2>
                  <For each={section.flags}>
                    {(flag) => (
                      <SettingsRowV2
                        title={language.t(`mod.experimental.flag.${flag.key}`)}
                        description={language.t(`mod.experimental.flag.${flag.key}.description`)}
                      >
                        <Show
                          when={flag.kind === "number"}
                          fallback={
                            <Switch
                              hideLabel
                              checked={flags()[flag.key] === "true"}
                              onChange={(checked: boolean) => set(flag.key, checked ? "true" : undefined)}
                            >
                              {language.t(`mod.experimental.flag.${flag.key}`)}
                            </Switch>
                          }
                        >
                          <TextInputV2
                            numeric
                            inputMode="numeric"
                            value={flags()[flag.key] ?? ""}
                            onChange={(event) => setNumber(flag.key, event.currentTarget.value)}
                          />
                        </Show>
                      </SettingsRowV2>
                    )}
                  </For>
                </SettingsListV2>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  )
}
