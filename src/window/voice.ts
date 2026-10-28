import { ComposerPill, type ComposerPillView, type Plugin } from "@opencode/plugin/gui"
import { Voice } from "../voice/contract"
import type definition from "./index"

// Voice in each window: a pill above the composer to start and stop listening, and what was said put into the message
// box, or sent at once. An answer to a spoken message can be read aloud.

const MAX_SPOKEN = 1_500

/** The assistant's words, fit for speaking: no code blocks, no markdown marks, not too long. */
export function speakable(text: string) {
  const plain = text
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return plain.length > MAX_SPOKEN ? `${plain.slice(0, MAX_SPOKEN)}…` : plain
}

export function registerVoice(ctx: Parameters<Plugin.Setup<typeof definition>>[0]) {
  const voice = ctx.main(Voice)

  const speakReply = async (session: NonNullable<ReturnType<typeof ctx.sessions.current>>) => {
    const client = session.server.client
    await client.session.wait({ sessionID: session.id })
    const [reply] = (await client.message.list({ sessionID: session.id, limit: 1, order: "desc", type: "assistant" })).data
    const content = (reply as { content?: readonly { type: string; text?: string }[] } | undefined)?.content ?? []
    const text = speakable(content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n"))
    if (text) await voice.speak(text)
  }

  // Removed with the plugin.
  voice.on("transcript", ({ text }) => {
      const screen = ctx.screen.current()
      const session = ctx.sessions.current()
      if (!screen || !session) {
        ctx.toast.show({ title: ctx.t("voice.noSession"), description: text, variant: "error" })
        return
      }
      const settings = voice.state()?.settings
      if (!settings?.autoSend) {
        screen.composer.insert(text)
        screen.composer.focus()
        return
      }
      const draft = screen.composer.text().trim()
      const prompt = draft ? `${draft}\n\n${text}` : text
      void session.server.client.session
        .prompt({ sessionID: session.id, text: prompt })
        .then(() => {
          if (draft) screen.composer.setText("")
          if (settings.speakReplies) return speakReply(session)
        })
        .catch((cause: unknown) => {
          // Not sent: the words stay in the message box instead of being lost.
          screen.composer.insert(text)
          ctx.toast.show({
            title: ctx.t("voice.sendFailed"),
            description: cause instanceof Error ? cause.message : String(cause),
            variant: "error",
          })
        })
  })

  ctx.add(ComposerPill, {
    id: "voice",
    order: -20,
    show: (): ComposerPillView | undefined => {
      const state = voice.state()
      if (!state?.settings.enabled) return undefined
      const hint = state.shortcutActive ? ctx.t("voice.pill.hint", { shortcut: state.settings.shortcut }) : ""
      switch (state.phase) {
        case "listening":
          return { label: ctx.t("voice.pill.listening"), tone: "danger", title: ctx.t("voice.pill.stop"), run: () => void voice.toggle() }
        case "transcribing":
          return { label: ctx.t("voice.pill.transcribing"), tone: "warning" }
        case "speaking":
          return { label: ctx.t("voice.pill.speaking"), tone: "success", title: ctx.t("voice.pill.hush"), run: () => void voice.hush() }
        default:
          return {
            label: ctx.t("voice.pill.idle"),
            ...(state.error ? { tone: "danger" as const } : {}),
            title: state.error ? `${ctx.t("voice.pill.start")} · ${state.error}` : `${ctx.t("voice.pill.start")}${hint ? ` (${hint})` : ""}`,
            run: () => void voice.toggle(),
          }
      }
    },
  })
}
