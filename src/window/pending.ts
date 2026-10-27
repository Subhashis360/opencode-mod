import { ComposerPill, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { createSignal, untrack } from "solid-js"
import type definition from "./index"

// OpenCode Mod: Claude-style pending messages. A message sent while the agent works goes to the session's inbox and
// rides along with the agent's next step ("steer"). OpenCode shows nothing for it until then; this pill lists those
// messages above the composer so they can be edited, held until the run ends, or removed before the agent reads them.

type Pending = { id: string; text: string }
type Session = ComposerPillProps["session"]
type Action = "edit" | "queue" | "remove"

const POLL_MS = 1_000
// A session is polled while its composer was drawn recently or it still has pending messages.
const FORGET_MS = 15_000
const MAX_LABEL = 90

const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat
}

export function registerPending(ctx: Parameters<Plugin.Setup<typeof definition>>[0]) {
  const [pending, setPending] = createSignal<Record<string, readonly Pending[]>>({})
  const watched = new Map<string, { session: Session; seen: number }>()

  const read = async (session: Session) => {
    const inbox = await session.server.client.session.inbox.list({ sessionID: session.id })
    const steering = inbox.flatMap((item) =>
      item.type === "user" && item.delivery === "steer" ? [{ id: item.id, text: item.payload.text }] : [],
    )
    setPending((all) => ({ ...all, [session.id]: steering }))
  }

  const tick = () => {
    const now = Date.now()
    for (const [id, entry] of watched) {
      if (now - entry.seen > FORGET_MS && !pending()[id]?.length) {
        watched.delete(id)
        continue
      }
      void read(entry.session).catch(() => undefined)
    }
  }

  const timer = setInterval(tick, POLL_MS)
  ctx.signal.addEventListener("abort", () => clearInterval(timer))

  const act = async (input: ComposerPillProps, item: Pending) => {
    const remove = () =>
      input.session.server.client.session.inbox.cancel({ sessionID: input.session.id, inboxID: item.id })

    const options: { title: string; value: Action; description?: string }[] = [
      { title: ctx.t("pending.edit"), value: "edit", description: ctx.t("pending.edit.description") },
      { title: ctx.t("pending.queue"), value: "queue", description: ctx.t("pending.queue.description") },
      { title: ctx.t("pending.remove"), value: "remove" },
    ]
    const choice = await ctx.dialogs.select<Action>({ title: oneLine(item.text), options })
    if (!choice) return

    try {
      if (choice === "queue")
        await input.session.server.client.session.inbox.update({
          sessionID: input.session.id,
          inboxID: item.id,
          delivery: "queue",
        })
      else await remove()
    } catch {
      // The agent read it in the meantime: it is part of the conversation now.
      ctx.toast.show({ title: ctx.t("pending.alreadyRead"), variant: "error" })
      void read(input.session).catch(() => undefined)
      return
    }

    if (choice === "edit") {
      const current = input.screen.composer.text().trim()
      input.screen.composer.setText(current ? `${item.text}\n\n${current}` : item.text)
      input.screen.composer.focus()
    }
    setPending((all) => ({
      ...all,
      [input.session.id]: (all[input.session.id] ?? []).filter((entry) => entry.id !== item.id),
    }))
    void read(input.session).catch(() => undefined)
  }

  ctx.add(ComposerPill, {
    id: "pending",
    order: -10,
    show: (input) => {
      untrack(() => {
        const known = watched.get(input.session.id)
        if (known) known.seen = Date.now()
        else {
          watched.set(input.session.id, { session: input.session, seen: Date.now() })
          void read(input.session).catch(() => undefined)
        }
      })

      const items = pending()[input.session.id] ?? []
      if (!items.length) return undefined

      return {
        label: ctx.t("pending.count", { count: items.length }),
        title: ctx.t("pending.title"),
        tone: "warning",
        rows: items.map((item) => ({
          id: item.id,
          label: oneLine(item.text) || ctx.t("pending.attachment"),
          detail: ctx.t("pending.steer"),
          run: () => void act(input, item),
        })),
      }
    },
  })
}
