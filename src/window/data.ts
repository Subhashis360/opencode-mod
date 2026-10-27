import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { Mod } from "../server/rpc"
import type definition from "./index"
import { useExtension } from "./ui"

/** The server part's API on the desktop's own server, which runs the plugin; the Mod settings change that machine. */
function useModServer() {
  const ctx = useExtension<typeof definition>()

  // ctx.client follows the server across restarts, so it is read on every call.
  const server = () => ({ url: "sidecar", client: ctx.client })
  const rpc = () => ctx.client.rpc(Mod.Definition)

  return { ctx, server, rpc }
}

/** A short confirmation after a change is written, so a switch or Save visibly took effect. */
function saved(ctx: ReturnType<typeof useExtension<typeof definition>>) {
  ctx.toast.show({ title: ctx.t("saved"), variant: "success", duration: 1500 })
}

/** Lists a custom provider's models from its API, through the server part. */
export function useModProviders() {
  const { rpc } = useModServer()

  return {
    fetchModels: (input: { baseURL: string; provider?: string; apiKey?: string; headers?: Record<string, string> }) =>
      rpc()["providers.models"](input),
  }
}

/** The global config file as plugin-mod reads it, and a way to change one entry of it. */
export function useModConfig() {
  const { ctx, server, rpc } = useModServer()
  const queryClient = useQueryClient()
  const key = () => [ctx.id, "config", server()?.url]

  const query = useQuery(() => ({
    queryKey: key(),
    queryFn: () => rpc()["config.read"]({}),
    enabled: !!server(),
  }))

  const write = useMutation(() => ({
    mutationFn: (input: { path: string[]; value?: unknown }) => rpc()["config.write"](input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(key(), snapshot)
      saved(ctx)
    },
  }))

  return {
    available: () => !!server(),
    query,
    values: () => query.data?.values ?? {},
    save: (path: string[], value?: unknown) => write.mutateAsync({ path, value }),
    saving: () => write.isPending,
  }
}

export type ModConfig = ReturnType<typeof useModConfig>

type SettingsChange = {
  computerUse?: boolean
  stayInTray?: boolean
  openAtLogin?: boolean
  aurora?: Mod.Settings["aurora"]
}

/** The mod's own settings (computer use, the glow) and a way to change them. */
export function useModSettings() {
  const { ctx, server, rpc } = useModServer()
  const queryClient = useQueryClient()
  const key = () => [ctx.id, "settings", server()?.url]

  const query = useQuery(() => ({
    queryKey: key(),
    queryFn: () => rpc()["settings.read"]({}),
    enabled: !!server(),
  }))

  const write = useMutation(() => ({
    mutationFn: (input: SettingsChange) => rpc()["settings.write"](input),
    onSuccess: (settings) => {
      queryClient.setQueryData(key(), settings)
      saved(ctx)
    },
  }))

  return {
    query,
    save: (input: SettingsChange) => write.mutateAsync(input),
    saving: () => write.isPending,
  }
}

export type ModSettingsData = ReturnType<typeof useModSettings>

/** Scheduled tasks, their runs and the changes the Scheduled tab makes. The list refreshes while it is open. */
export function useModSchedule() {
  const { ctx, server, rpc } = useModServer()
  const queryClient = useQueryClient()
  const key = () => [ctx.id, "schedule", server()?.url]

  const tasks = useQuery(() => ({
    queryKey: key(),
    queryFn: () => rpc()["schedule.list"]({}),
    enabled: !!server(),
    refetchInterval: 5_000,
  }))

  const projects = useQuery(() => ({
    queryKey: [ctx.id, "projects", server()?.url],
    queryFn: () => server()!.client.project.list(),
    enabled: !!server(),
  }))

  const refresh = () => queryClient.invalidateQueries({ queryKey: key() })

  // Every change goes through the server, which re-plans the task; the list is reloaded after it.
  const change = async <A>(fn: () => Promise<A>) => {
    const result = await fn()

    await refresh()

    return result
  }

  return {
    tasks,
    projects: () => (projects.data ?? []).map((project) => project.canonical),
    runs: (taskID: string) => rpc()["schedule.runs"]({ taskID }),
    create: (input: Mod.ScheduleTaskInput) => change(() => rpc()["schedule.create"](input)),
    update: (id: string, patch: Mod.ScheduleTaskPatch) => change(() => rpc()["schedule.update"]({ id, patch })),
    remove: (id: string) => change(() => rpc()["schedule.remove"]({ id })),
    run: (id: string) => change(() => rpc()["schedule.run"]({ id })),
    stop: (id: string) => change(() => rpc()["schedule.stop"]({ id })),
  }
}

export type ModSchedule = ReturnType<typeof useModSchedule>

/** The user's hooks, saved as one list. */
export function useModHooks() {
  const { ctx, server, rpc } = useModServer()
  const queryClient = useQueryClient()
  const key = () => [ctx.id, "hooks", server()?.url]

  const hooks = useQuery(() => ({ queryKey: key(), queryFn: () => rpc()["hooks.list"]({}), enabled: !!server() }))

  return {
    hooks,
    save: async (list: readonly Mod.Hook[]) =>
      queryClient.setQueryData(key(), await rpc()["hooks.save"]({ hooks: list })),
    test: (command: string, event: Mod.Hook["event"]) => rpc()["hooks.test"]({ command, event }),
  }
}

/** Saved memories and the memory switch. */
export function useModMemory() {
  const { ctx, server, rpc } = useModServer()
  const queryClient = useQueryClient()
  const key = () => [ctx.id, "memory", server()?.url]

  const memory = useQuery(() => ({ queryKey: key(), queryFn: () => rpc()["memory.read"]({}), enabled: !!server() }))

  const change = async (fn: () => Promise<unknown>) => {
    await fn()
    await queryClient.invalidateQueries({ queryKey: key() })
  }

  return {
    memory,
    save: (input: { id?: string; text: string; scope: Mod.MemoryEntry["scope"]; project?: string }) =>
      change(() => rpc()["memory.save"](input)),
    remove: (id: string) => change(() => rpc()["memory.remove"]({ id })),
    enable: (enabled: boolean) => change(() => rpc()["memory.enable"]({ enabled })),
  }
}

/** Saved prompts, and OpenCode's current built-in prompts fetched from upstream on request. */
export function useModPrompts() {
  const { ctx, server, rpc } = useModServer()
  const queryClient = useQueryClient()
  const key = () => [ctx.id, "prompts", server()?.url]

  const library = useQuery(() => ({ queryKey: key(), queryFn: () => rpc()["prompts.library"]({}), enabled: !!server() }))

  const upstream = useQuery(() => ({
    queryKey: [ctx.id, "prompts-upstream"],
    queryFn: () => rpc()["prompts.upstream"]({}),
    enabled: !!server(),
    staleTime: 60 * 60_000,
  }))

  const change = async (fn: () => Promise<unknown>) => {
    await fn()
    await queryClient.invalidateQueries({ queryKey: key() })
  }

  return {
    library,
    upstream,
    keep: (input: { id?: string; name: string; content: string }) => change(() => rpc()["prompts.keep"](input)),
    drop: (id: string) => change(() => rpc()["prompts.drop"]({ id })),
  }
}

const DAY = 86_400_000

/** Free-model usage per day from OpenCode's own usage stats: today and the six days before. */
export function useModUsage() {
  const { ctx, server } = useModServer()

  return useQuery(() => ({
    queryKey: [ctx.id, "usage", server()?.url],
    enabled: !!server(),
    refetchInterval: 60_000,
    queryFn: async () => {
      const client = server()!.client
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const today = new Date()

      today.setHours(0, 0, 0, 0)

      return Promise.all(
        Array.from({ length: 7 }, async (_, index) => {
          const from = today.getTime() - index * DAY
          const stats = await client.session.stats({ from, to: from + DAY, timezone, tools: "none" })

          return { day: from, models: stats.models }
        }),
      )
    },
  }))
}
