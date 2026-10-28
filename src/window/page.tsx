import { createEffect, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js"
import AgentsTab from "./agents"
import CommandsTab from "./commands"
import ComputerTab from "./computer"
import { useModConfig, useModPrompts, type ModConfig } from "./data"
import ExperimentalTab from "./experimental"
import HooksTab from "./hooks"
import LimitsTab from "./limits"
import type definition from "./index"
import McpTab from "./mcp"
import MemoryTab from "./memory"
import PermissionsTab from "./permissions"
import PromptsTab from "./prompts"
import ProvidersTab from "./providers"
import ScheduleTab from "./schedule"
import { errorMessage } from "./shared"
import { useExtension } from "./ui"
import UpdatesTab from "./updates"

// The Mod menu's tabs, in order. Each renders from the shared config query.
const TABS = [
  { id: "agents", render: (config: ModConfig) => <AgentsTab config={config} /> },
  { id: "providers", render: (config: ModConfig) => <ProvidersTab config={config} /> },
  { id: "commands", render: (config: ModConfig) => <CommandsTab config={config} /> },
  { id: "mcp", render: (config: ModConfig) => <McpTab config={config} /> },
  { id: "permissions", render: (config: ModConfig) => <PermissionsTab config={config} /> },
  { id: "schedule", render: () => <ScheduleTab /> },
  { id: "hooks", render: () => <HooksTab /> },
  { id: "memory", render: () => <MemoryTab /> },
  { id: "prompts", render: (config: ModConfig) => <PromptsTab config={config} /> },
  { id: "limits", render: () => <LimitsTab /> },
  { id: "computer", render: () => <ComputerTab /> },
  { id: "experimental", render: (config: ModConfig) => <ExperimentalTab config={config} /> },
  { id: "updates", render: () => <UpdatesTab /> },
] as const satisfies readonly { id: string; render: (config: ModConfig) => JSX.Element }[]

export type Tab = (typeof TABS)[number]["id"]

export const TAB_IDS: readonly Tab[] = TABS.map((tab) => tab.id)

// The navigation, grouped the way people look for things: what the agent is, what it can use, which models it
// runs on, and what runs on its own.
const GROUPS: readonly { id: string; tabs: readonly Tab[] }[] = [
  { id: "agent", tabs: ["agents", "prompts", "commands", "memory"] },
  { id: "tools", tabs: ["mcp", "computer", "hooks", "permissions"] },
  { id: "models", tabs: ["providers", "limits"] },
  { id: "automation", tabs: ["schedule", "experimental"] },
  { id: "extension", tabs: ["updates"] },
]

// Search reveals an entry such as "mod-commands"; open its tab.
function tabFor(target: string | undefined): Tab {
  const tab = target?.replace(/^mod-/, "")

  return TAB_IDS.find((item) => item === tab) ?? "agents"
}

// The tab a command asked for: Settings opens a page by id only, so the command sets this first.
const [requested, setRequested] = createSignal<Tab>()

/** Opens the Mod page on `tab`, whether or not it is already open. */
export function requestTab(tab: Tab) {
  setRequested(undefined)
  setRequested(tab)
}

export default function ModPage(props: { target?: string }) {
  const ctx = useExtension<typeof definition>()
  const config = useModConfig()
  // Loaded with the page, so the System prompt tab opens with its text instead of filling in after a moment.
  useModPrompts()
  const [tab, setTab] = createSignal<Tab>(requested() ?? tabFor(props.target))
  const errorText = () => errorMessage(config.query.error)

  createEffect(() => {
    const next = requested()
    if (next) setTab(next)
  })

  // A search result reveals its entry's tab.
  createEffect(on(() => props.target, (target) => target && setTab(tabFor(target)), { defer: true }))

  return (
    <div data-ocm>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{ctx.t("title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{ctx.t("description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Switch>
          <Match when={!config.available()}>
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("config.unavailable")}</p>
          </Match>
          <Match when={config.query.isError}>
            <p class="text-12-regular text-text-danger-base" role="alert">
              {ctx.t("config.error", { error: errorText() })}
            </p>
          </Match>
          <Match when={!config.query.data}>
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("config.loading")}</p>
          </Match>
          <Match when={config.query.data}>
            {(snapshot) => (
              <div class="flex flex-col gap-4">
                <nav class="ocm-nav" aria-label={ctx.t("title")}>
                  <For each={GROUPS}>
                    {(group) => (
                      <div class="ocm-nav-group" role="tablist" aria-label={ctx.t(`group.${group.id}`)}>
                        <span class="ocm-nav-label">{ctx.t(`group.${group.id}`)}</span>
                        <div class="ocm-nav-items">
                          <For each={group.tabs}>
                            {(id) => (
                              <button
                                type="button"
                                role="tab"
                                class="ocm-nav-item"
                                aria-selected={tab() === id}
                                onClick={() => setTab(id)}
                              >
                                {ctx.t(`tab.${id}`)}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </nav>
                <For each={TABS}>
                  {(item) => (
                    <Show when={tab() === item.id}>
                      <section class="ocm-panel" role="tabpanel" aria-label={ctx.t(`tab.${item.id}`)}>
                        <h3 class="ocm-panel-title">{ctx.t(`tab.${item.id}`)}</h3>
                        {item.render(config)}
                      </section>
                    </Show>
                  )}
                </For>
                <Show when={snapshot().path}>
                  <p class="text-11-regular text-v2-text-text-muted">
                    {ctx.t("config.file", { path: snapshot().path })}
                  </p>
                </Show>
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
