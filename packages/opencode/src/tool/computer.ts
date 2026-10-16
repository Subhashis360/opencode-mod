import { Effect, Schema } from "effect"
import { readFile, rm } from "fs/promises"
import path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./computer.txt"
import { ComputerDriver, type Display, type Element, type WindowInfo } from "@/computer/driver"
import { EffectBridge } from "@/effect/bridge"

const ACTIONS = [
  "screenshot",
  "zoom",
  "read_window",
  "click_element",
  "list_displays",
  "cursor_position",
  "mouse_move",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "left_click_drag",
  "left_mouse_down",
  "left_mouse_up",
  "scroll",
  "type",
  "key",
  "hold_key",
  "wait",
  "open_application",
  "read_clipboard",
  "write_clipboard",
] as const

type Action = (typeof ACTIONS)[number]

const StepFields = {
  action: Schema.Literals(ACTIONS).annotate({ description: "The action to perform" }),
  coordinate: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "[x, y] in the screenshot coordinate frame of the current display",
  }),
  start_coordinate: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "[x, y] where left_click_drag starts",
  }),
  region: Schema.optional(Schema.Array(Schema.Number)).annotate({ description: "[x0, y0, x1, y1] for zoom" }),
  text: Schema.optional(Schema.String).annotate({
    description:
      "type: text to type. key/hold_key: keys like 'ctrl+s' or 'Down Down Enter'. Click actions: modifier keys to hold. click_element/read_window: text to find. open_application: app name. write_clipboard: text",
  }),
  scroll_direction: Schema.optional(Schema.Literals(["up", "down", "left", "right"])),
  scroll_amount: Schema.optional(Schema.Number).annotate({ description: "Wheel notches, default 3" }),
  duration: Schema.optional(Schema.Number).annotate({ description: "Seconds for wait and hold_key (max 10)" }),
  display: Schema.optional(Schema.Number).annotate({
    description: "Display index from list_displays (0 is the primary). Switches the current display",
  }),
}

const Step = Schema.Struct(StepFields)

export const Parameters = Schema.Struct({
  ...StepFields,
  screenshot_after: Schema.optional(Schema.Boolean).annotate({
    description:
      "Attach a screenshot of the current display after the action(s). Defaults to true when the last step changes the screen (clicks, drag, scroll, key, type, wait, open_application); set false to skip it",
  }),
  actions: Schema.optional(Schema.Array(Step)).annotate({
    description: "Run several steps in order in one call. When set, the top-level action is run first",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type StepParams = Schema.Schema.Type<typeof Step>
type Attachment = NonNullable<Tool.ExecuteResult["attachments"]>[number]

// Small frames keep image tokens low; zoom gives full detail where it matters.
const MAX_EDGE = 1280
const MAX_PIXELS = 1_000_000
const READ_LIMIT = 100

// Terminals and IDEs get pointer access only, so typing can never bypass the shell tool's permissions.
const TERMINALS = new Set([
  "windowsterminal",
  "wt",
  "cmd",
  "powershell",
  "pwsh",
  "conhost",
  "openconsole",
  "mintty",
  "alacritty",
  "wezterm-gui",
  "kitty",
  "hyper",
  "tabby",
  "warp",
  "code",
  "code - insiders",
  "cursor",
  "windsurf",
  "devenv",
  "idea64",
  "pycharm64",
  "webstorm64",
  "rider64",
  "clion64",
  "goland64",
])
const POINTER_ONLY: Action[] = ["left_click", "scroll", "mouse_move", "double_click"]
// The model nearly always looked again after these, spending a whole turn on a bare screenshot call,
// so the screenshot comes back with the action unless it opts out.
const CHANGES_SCREEN = new Set<Action>([
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "left_click_drag",
  "scroll",
  "key",
  "type",
  "hold_key",
  "wait",
  "open_application",
])
const INTERACTIVE = new Set([
  "button",
  "checkbox",
  "combobox",
  "edit",
  "hyperlink",
  "listitem",
  "menuitem",
  "radiobutton",
  "tabitem",
  "treeitem",
  "splitbutton",
])

const current = new Map<string, number>()
let displays: { list: Display[]; at: number } | undefined

async function screens(refresh = false) {
  if (!refresh && displays && Date.now() - displays.at < 15_000) return displays.list
  const list = await ComputerDriver.call<Display[]>("screens")
  displays = { list, at: Date.now() }
  return list
}

function frame(display: Display) {
  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(display.width, display.height),
    Math.sqrt(MAX_PIXELS / (display.width * display.height)),
  )
  return { scale, width: Math.round(display.width * scale), height: Math.round(display.height * scale) }
}

function toPhysical(display: Display, point: readonly number[] | undefined, name = "coordinate") {
  if (!point || point.length !== 2) throw new Error(`${name} must be [x, y]`)
  const { scale, width, height } = frame(display)
  const x = Math.min(Math.max(point[0], 0), width - 1)
  const y = Math.min(Math.max(point[1], 0), height - 1)
  return { x: display.x + Math.round(x / scale), y: display.y + Math.round(y / scale) }
}

function toFrame(display: Display, x: number, y: number) {
  const { scale } = frame(display)
  return `${Math.round((x - display.x) * scale)},${Math.round((y - display.y) * scale)}`
}

function contains(display: Display, x: number, y: number) {
  return x >= display.x && y >= display.y && x < display.x + display.width && y < display.y + display.height
}

async function target(sessionID: string, requested?: number) {
  const list = await screens(requested !== undefined)
  const index = requested ?? current.get(sessionID) ?? 0
  const display = list[index]
  if (!display) throw new Error(`There is no display ${index}; call list_displays`)
  current.set(sessionID, index)
  return { display, index }
}

async function capture(display: Display, region?: { x: number; y: number; width: number; height: number }) {
  const area = region ?? { x: display.x, y: display.y, width: display.width, height: display.height }
  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(area.width, area.height),
    Math.sqrt(MAX_PIXELS / (area.width * area.height)),
  )
  const width = Math.max(1, Math.round(area.width * scale))
  const height = Math.max(1, Math.round(area.height * scale))
  const file = path.join(await ComputerDriver.tempDir(), `shot-${process.pid}-${Date.now()}.jpg`)
  await ComputerDriver.call("capture", { ...area, targetWidth: width, targetHeight: height, path: file })
  const bytes = await readFile(file)
  await rm(file, { force: true })
  return {
    width,
    height,
    attachment: {
      type: "file",
      mime: "image/jpeg",
      url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    } as Attachment,
  }
}

function describe(window: WindowInfo | null) {
  return window ? `${window.process}${window.title ? ` "${window.title.slice(0, 60)}"` : ""}` : "the desktop"
}

function line(element: Element, display: Display) {
  const value = element.value ? ` ="${element.value}"` : ""
  return `${element.type} "${element.name}"${value} @${toFrame(display, element.x, element.y)}${element.disabled ? " (disabled)" : ""}`
}

function best(elements: Element[], query: string) {
  const wanted = query.trim().toLowerCase()
  const rank = (element: Element) => {
    const name = element.name.toLowerCase()
    const match = name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2
    return match * 4 + (INTERACTIVE.has(element.type) ? 0 : 2) + (element.disabled ? 1 : 0)
  }
  return elements.toSorted((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)[0]
}

export const ComputerTool = Tool.define(
  "computer",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const bridge = yield* EffectBridge.make()
          // A denied prompt must stop the run like it does for every other tool, so it is re-raised as-is.
          let rejection: unknown
          const ask = (patterns: string[], metadata: Record<string, unknown>) =>
            bridge
              .promise(ctx.ask({ permission: "computer", patterns, always: patterns, metadata }))
              .catch((error: unknown) => {
                rejection = error
                throw error
              })

          const guard = async (action: Action, window: WindowInfo | null, modifiers?: string) => {
            if (!window) return ask(["screen"], { action })
            const app = window.process.toLowerCase()
            if (/opencode/.test(app) || window.pid === process.pid || window.pid === process.ppid)
              throw new Error("OpenCode cannot control its own window")
            if (TERMINALS.has(app) && (!POINTER_ONLY.includes(action) || modifiers))
              throw new Error(
                `${window.process} is a terminal or IDE: only plain clicks and scrolling are allowed there. Use the shell or edit tools instead`,
              )
            return ask([app], { action, app: window.process, title: window.title })
          }

          const at = (x: number, y: number) => ComputerDriver.call<WindowInfo | null>("window_at", { x, y })
          const foreground = () => ComputerDriver.call<WindowInfo | null>("foreground")
          const attachments: Attachment[] = []
          const output: string[] = []

          const run = async (step: StepParams) => {
            const { display, index } = await target(ctx.sessionID, step.display)
            const action = step.action
            switch (action) {
              case "list_displays": {
                const list = await screens(true)
                return list
                  .map(
                    (item, i) =>
                      `${i}: ${item.width}x${item.height}${item.primary ? " primary" : ""} -> frame ${frame(item).width}x${frame(item).height}`,
                  )
                  .join("\n")
              }
              case "screenshot": {
                await ask(["screen"], { action })
                const shot = await capture(display)
                attachments.push(shot.attachment)
                return `display ${index} ${shot.width}x${shot.height}`
              }
              case "zoom": {
                await ask(["screen"], { action })
                const region = step.region
                if (!region || region.length !== 4) throw new Error("region must be [x0, y0, x1, y1]")
                const a = toPhysical(display, [region[0], region[1]], "region")
                const b = toPhysical(display, [region[2], region[3]], "region")
                const shot = await capture(display, {
                  x: Math.min(a.x, b.x),
                  y: Math.min(a.y, b.y),
                  width: Math.max(1, Math.abs(b.x - a.x)),
                  height: Math.max(1, Math.abs(b.y - a.y)),
                })
                attachments.push(shot.attachment)
                return `zoom ${shot.width}x${shot.height} (coordinates still use the full display frame)`
              }
              case "cursor_position": {
                const point = await ComputerDriver.call<{ x: number; y: number }>("cursor")
                return contains(display, point.x, point.y)
                  ? `cursor @${toFrame(display, point.x, point.y)}`
                  : "cursor is on another display"
              }
              case "read_window":
              case "click_element": {
                await ask(["screen"], { action })
                if (action === "click_element" && !step.text) throw new Error("click_element needs text to find")
                const source = step.coordinate ? { source: "point", ...toPhysical(display, step.coordinate) } : {}
                const result = await ComputerDriver.call<{
                  window: WindowInfo | null
                  elements: Element[]
                  truncated: boolean
                }>(
                  "elements",
                  { ...source, query: step.text ?? "", limit: action === "click_element" ? 400 : READ_LIMIT },
                  10_000,
                )
                const list = await screens()
                const home = list.findIndex(
                  (item) => result.elements[0] && contains(item, result.elements[0].x, result.elements[0].y),
                )
                const screen = list[home] ?? display
                if (home >= 0) current.set(ctx.sessionID, home)
                const visible = result.elements.filter(
                  (element) =>
                    contains(screen, element.x, element.y) &&
                    !(element.type === "pane" && element.name === result.window?.title),
                )
                if (action === "read_window") {
                  if (visible.length === 0)
                    return `${describe(result.window)}: no readable elements${step.text ? ` matching "${step.text}"` : ""}; take a screenshot`
                  const more = result.truncated ? `\n(more elements exist; pass text to filter)` : ""
                  return `${describe(result.window)} on display ${home >= 0 ? home : index}:\n${visible.map((element) => line(element, screen)).join("\n")}${more}`
                }
                const element = best(visible, step.text!)
                if (!element)
                  throw new Error(
                    `No element matching "${step.text}" in ${describe(result.window)}; try read_window or a screenshot`,
                  )
                await guard("left_click", result.window)
                // Accessibility activation leaves the user's cursor alone; a real click is only the fallback.
                const activated = await ComputerDriver.call<{ invoked: boolean; via?: string }>(
                  "invoke",
                  { x: element.x, y: element.y },
                  6_000,
                ).catch(() => ({ invoked: false, via: undefined }))
                if (activated.invoked) return `activated ${line(element, screen)} (${activated.via}, cursor not moved)`
                await ComputerDriver.call("click", { x: element.x, y: element.y, button: "left", count: 1 })
                return `clicked ${line(element, screen)} (no accessible action, used the mouse)`
              }
              case "mouse_move": {
                const point = toPhysical(display, step.coordinate)
                await guard(action, await at(point.x, point.y))
                await ComputerDriver.call("move", point)
                return `moved to @${toFrame(display, point.x, point.y)}`
              }
              case "left_click":
              case "right_click":
              case "middle_click":
              case "double_click":
              case "triple_click": {
                const point = step.coordinate
                  ? toPhysical(display, step.coordinate)
                  : await ComputerDriver.call<{ x: number; y: number }>("cursor")
                const window = await at(point.x, point.y)
                await guard(action, window, step.text)
                await ComputerDriver.call("click", {
                  ...point,
                  button: action === "right_click" ? "right" : action === "middle_click" ? "middle" : "left",
                  count: action === "double_click" ? 2 : action === "triple_click" ? 3 : 1,
                  modifiers: step.text ?? "",
                })
                return `${action} @${toFrame(display, point.x, point.y)} on ${describe(window)}`
              }
              case "left_click_drag": {
                const from = toPhysical(display, step.start_coordinate, "start_coordinate")
                const to = toPhysical(display, step.coordinate)
                await guard(action, await at(from.x, from.y))
                await ComputerDriver.call("drag", { x1: from.x, y1: from.y, x2: to.x, y2: to.y })
                return `dragged to @${toFrame(display, to.x, to.y)}`
              }
              case "left_mouse_down":
              case "left_mouse_up": {
                const point = await ComputerDriver.call<{ x: number; y: number }>("cursor")
                await guard(action, await at(point.x, point.y))
                await ComputerDriver.call("button", {
                  button: "left",
                  state: action === "left_mouse_down" ? "down" : "up",
                })
                return action
              }
              case "scroll": {
                const point = step.coordinate
                  ? toPhysical(display, step.coordinate)
                  : await ComputerDriver.call<{ x: number; y: number }>("cursor")
                const window = await at(point.x, point.y)
                await guard(action, window)
                await ComputerDriver.call("scroll", {
                  ...point,
                  direction: step.scroll_direction ?? "down",
                  amount: Math.min(Math.max(Math.round(step.scroll_amount ?? 3), 1), 30),
                })
                return `scrolled ${step.scroll_direction ?? "down"} on ${describe(window)}`
              }
              case "type":
              case "key":
              case "hold_key": {
                if (!step.text) throw new Error(`${action} needs text`)
                const window = await foreground()
                await guard(action, window)
                if (action === "type") await ComputerDriver.call("type", { text: step.text }, 120_000)
                else if (action === "key") await ComputerDriver.call("key", { keys: step.text })
                else
                  await ComputerDriver.call(
                    "hold",
                    { keys: step.text, ms: Math.min(step.duration ?? 1, 10) * 1000 },
                    15_000,
                  )
                return `${action} into ${describe(window)}`
              }
              case "wait": {
                const ms = Math.min(Math.max(step.duration ?? 1, 0), 10) * 1000
                await new Promise((resolve) => setTimeout(resolve, ms))
                return `waited ${ms / 1000}s`
              }
              case "open_application": {
                if (!step.text) throw new Error("open_application needs the app name in text")
                await ask([`open:${step.text.toLowerCase()}`], { action, app: step.text })
                const opened = await ComputerDriver.call<string>("open", { name: step.text })
                return `opened ${opened}`
              }
              case "read_clipboard": {
                await ask(["clipboard"], { action })
                return (await ComputerDriver.call<string>("clipboard_get")) || "(clipboard is empty)"
              }
              case "write_clipboard": {
                await ask(["clipboard"], { action })
                await ComputerDriver.call("clipboard_set", { text: step.text ?? "" })
                return "clipboard updated"
              }
            }
            throw new Error(`Unknown action: ${String(action)}`)
          }

          const steps: StepParams[] = [params, ...(params.actions ?? [])]
          const failure = yield* Effect.promise(async () => {
            for (const [i, step] of steps.entries()) {
              if (ctx.abort.aborted) return "aborted"
              const result = await run(step).then(
                (text) => ({ text }),
                (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
              )
              if (rejection) return "rejected"
              if ("error" in result)
                return steps.length > 1 ? `step ${i + 1} (${step.action}) failed: ${result.error}` : result.error
              output.push(steps.length > 1 ? `${i + 1}. ${result.text}` : result.text)
            }
            const last = steps.at(-1)!.action
            if ((params.screenshot_after ?? CHANGES_SCREEN.has(last)) && last !== "screenshot") {
              await ask(["screen"], { action: "screenshot" }).catch(() => {})
              if (rejection) return "rejected"
              await new Promise((resolve) => setTimeout(resolve, 150))
              const { display, index } = await target(ctx.sessionID)
              const shot = await capture(display)
              attachments.push(shot.attachment)
              output.push(`screenshot display ${index} ${shot.width}x${shot.height}`)
            }
            return undefined
          })
          if (rejection) return yield* Effect.die(rejection)
          if (failure && output.length === 0) return yield* Effect.fail(new Error(failure))

          return {
            title: steps.length > 1 ? `${steps.length} desktop actions` : params.action,
            output: [...output, ...(failure ? [failure] : [])].join("\n"),
            metadata: {},
            ...(attachments.length ? { attachments } : {}),
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
