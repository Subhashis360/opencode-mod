import { Command, type Plugin, SettingsPage, Style } from "@opencode/plugin/gui"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type definition from "./index"
import Page, { requestTab } from "./page"
import { registerPending } from "./pending"
import { css } from "./style"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // The bundle has its own copy of solid-query, so it brings its own client rather than the app's.
  const queries = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

  ctx.add(Style, css)
  registerPending(ctx)

  ctx.add(SettingsPage, {
    id: "mod",
    icon: "outline-sliders",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        {
          id: "mod-agents",
          title: ctx.t("tab.agents"),
          description: ctx.t("agents.description"),
          keywords: "agent prompt template",
        },
        {
          id: "mod-commands",
          title: ctx.t("tab.commands"),
          description: ctx.t("commands.description"),
          keywords: "slash command",
        },
        { id: "mod-mcp", title: ctx.t("tab.mcp"), description: ctx.t("mcp.description"), keywords: "mcp server tools" },
        {
          id: "mod-permissions",
          title: ctx.t("tab.permissions"),
          description: ctx.t("permissions.description"),
          keywords: "permission allow ask deny preset",
        },
        {
          id: "mod-schedule",
          title: ctx.t("tab.schedule"),
          description: ctx.t("schedule.description"),
          keywords: "schedule scheduled cron daily weekly recurring automation task",
        },
        {
          id: "mod-hooks",
          title: ctx.t("tab.hooks"),
          description: ctx.t("hooks.description"),
          keywords: "hook event command pretooluse",
        },
        {
          id: "mod-memory",
          title: ctx.t("tab.memory"),
          description: ctx.t("memory.description"),
          keywords: "memory remember facts",
        },
        {
          id: "mod-prompts",
          title: ctx.t("tab.prompts"),
          description: ctx.t("prompts.description"),
          keywords: "system prompt agent instructions",
        },
        {
          id: "mod-limits",
          title: ctx.t("tab.limits"),
          description: ctx.t("limits.description"),
          keywords: "free tier limit usage requests tokens",
        },
        {
          id: "mod-computer",
          title: ctx.t("tab.computer"),
          description: ctx.t("computer.description"),
          keywords: "computer use desktop click screenshot android aurora glow cursor",
        },
        {
          id: "mod-experimental",
          title: ctx.t("tab.experimental"),
          description: ctx.t("experimental.description"),
          keywords: "experimental todo compaction subagent",
        },
        {
          id: "mod-providers",
          title: ctx.t("tab.providers"),
          description: ctx.t("providers.description"),
          keywords: "provider custom openai compatible base url api key models fetch",
        },
      ]
    },
    render: (input) => (
      <QueryClientProvider client={queries}>
        <Page target={input.target} />
      </QueryClientProvider>
    ),
  })

  ctx.add(Command, {
    id: "open",
    get title() {
      return ctx.t("command.open")
    },
    run: () => ctx.layout.settings("mod"),
  })

  // The app's own Providers page has no Edit, and plugins cannot add to its menu; this opens the Mod editor.
  ctx.add(Command, {
    id: "providers",
    get title() {
      return ctx.t("command.providers")
    },
    keywords: "provider edit custom models fetch base url api key",
    run: () => {
      requestTab("providers")
      ctx.layout.settings("mod")
    },
  })
}

export default setup
