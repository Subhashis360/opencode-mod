export * as ComputerTool from "./tool.js"

import { Schema } from "effect"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { ComputerAndroid } from "./android.js"
import { ComputerAurora } from "./aurora.js"
import { ComputerDriver, type Display, type ScreenMap, type WindowInfo } from "./driver.js"
import { ComputerScreen, type Entry } from "./screen.js"

// The computer tool's actions, independent of the tool host: plugin-mod's index wraps `execute` as an OpenCode tool.

const ACTIONS = [
  "screenshot",
  "zoom",
  "read_window",
  "click_element",
  "set_value",
  "wait_for",
  "watch",
  "switch_window",
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

export type Action = (typeof ACTIONS)[number]

const StepFields = {
  action: Schema.Literals(ACTIONS).annotate({ description: "The action to perform" }),
  ref: Schema.optional(Schema.Number).annotate({
    description:
      "An element's [n] from the screen map. Acts on that element where it is now; use it instead of coordinate or text whenever the map lists the element",
  }),
  coordinate: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "[x, y] in the screenshot coordinate frame of the current display",
  }),
  start_ref: Schema.optional(Schema.Number).annotate({ description: "left_click_drag: the element to start from" }),
  start_coordinate: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "[x, y] where left_click_drag starts",
  }),
  region: Schema.optional(Schema.Array(Schema.Number)).annotate({ description: "[x0, y0, x1, y1] for zoom" }),
  text: Schema.optional(Schema.String).annotate({
    description:
      "type: text to type. key/hold_key: keys like 'ctrl+s' or 'Down Down Enter'. Click actions: modifier keys to hold. click_element/set_value/read_window/wait_for: text to find ('Admin > Login' = the Login inside Admin). switch_window/open_application: app or window name. write_clipboard: text",
  }),
  value: Schema.optional(Schema.String).annotate({
    description: "set_value: the text, the option to pick, true/false for a checkbox, or a number for a slider",
  }),
  gone: Schema.optional(Schema.Boolean).annotate({ description: "wait_for: wait until the text disappears instead" }),
  marks: Schema.optional(Schema.Boolean).annotate({
    description: "Number the elements on screenshots (default true); false gives a clean picture",
  }),
  scroll_direction: Schema.optional(Schema.Literals(["up", "down", "left", "right"])),
  scroll_amount: Schema.optional(Schema.Number).annotate({ description: "Wheel notches, default 3" }),
  duration: Schema.optional(Schema.Number).annotate({
    description:
      "Seconds: wait and hold_key (max 10), wait_for timeout (default 10, max 60), watch timeout (default 10, max 120), a long press for left_click on a phone",
  }),
  display: Schema.optional(Schema.Number).annotate({
    description: "Display index from list_displays (0 is the primary). Switches the current display",
  }),
  device: Schema.optional(Schema.String).annotate({
    description:
      "Control an Android phone over adb instead of this PC: 'android' for the only connected device, or a serial from list_displays with device 'android'",
  }),
}

const Step = Schema.Struct(StepFields)

export const Parameters = Schema.Struct({
  ...StepFields,
  screenshot_after: Schema.optional(Schema.Boolean).annotate({
    description:
      "Attach a screenshot of the current display after the action(s). Defaults to true when the last step changes the screen (clicks, drag, scroll, key, type, wait, open_application, switch_window); set false to skip it",
  }),
  actions: Schema.optional(Schema.Array(Step)).annotate({
    description: "Run several steps in order in one call. When set, the top-level action is run first",
  }),
})

export type Params = Schema.Schema.Type<typeof Parameters>
export type StepParams = Schema.Schema.Type<typeof Step>
/** A screenshot, returned to the model as a tool file content part. */
export type Attachment = { readonly type: "file"; readonly mime: string; readonly uri: string }

// Small frames keep image tokens low; zoom gives full detail where it matters.
const MAX_EDGE = 1280
const MAX_PIXELS = 1_000_000
const SCREEN_LIMIT = 150
const WINDOW_LIMIT = 200
const PIDS = `${process.pid},${process.ppid}`

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
// Actions that move the user's real mouse, refused while "Don't use my cursor" is on.
const MOUSE = new Set<Action>([
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
])
// The model nearly always looked again after these, spending a whole turn on a bare screenshot call,
// so the screenshot comes back with the action unless it opts out.
export const CHANGES_SCREEN = new Set<Action>([
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
  "switch_window",
])
// Kinds of element set_value can fill, so "set_value Email" picks the field rather than its label.
const SETTABLE = new Set(["edit", "combobox", "checkbox", "radiobutton", "slider", "spinner", "document", "list"])

const current = new Map<string, number>()
// The app window each session last worked in. read_window and click_element go there by default, because
// the foreground window is usually the OpenCode chat the user is watching.
const workingIn = new Map<string, number>()
const books = new Map<string, ComputerScreen.Refs>()
// Text already seen by watch, per session, window and filter, so each watch returns only what is new.
const watched = new Map<string, Set<string>>()
let displays: { list: Display[]; at: number } | undefined

function book(sessionID: string) {
  let refs = books.get(sessionID)
  if (!refs) books.set(sessionID, (refs = new ComputerScreen.Refs()))
  return refs
}

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

async function encode(file: string) {
  const bytes = await readFile(file).finally(() => rm(file, { force: true }))
  const attachment: Attachment = {
    type: "file",
    mime: "image/jpeg",
    uri: `data:image/jpeg;base64,${bytes.toString("base64")}`,
  }
  return attachment
}

async function shotPath() {
  return path.join(await ComputerDriver.tempDir(), `shot-${process.pid}-${Date.now()}.jpg`)
}

/** Has the helper write a screenshot to a file and reads it back; the file is gone afterwards, whatever happens. */
async function shoot(write: (file: string) => Promise<unknown>) {
  const file = await shotPath()
  try {
    await write(file)
    return await encode(file)
  } finally {
    await rm(file, { force: true })
  }
}

async function capture(display: Display, region: { x: number; y: number; width: number; height: number }) {
  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(region.width, region.height),
    Math.sqrt(MAX_PIXELS / (region.width * region.height)),
  )
  const width = Math.max(1, Math.round(region.width * scale))
  const height = Math.max(1, Math.round(region.height * scale))
  const attachment = await shoot((file) =>
    ComputerDriver.call("capture", { ...region, targetWidth: width, targetHeight: height, path: file }),
  )
  return { width, height, attachment }
}

// One look at a display: the screen map (controls and OCR text with refs) and, when asked, the screenshot with the
// listed elements numbered on it. Both come from the same moment, so the numbers on the picture match the text.
async function look(
  sessionID: string,
  display: Display,
  index: number,
  options: { image: boolean; marks: boolean; settle?: number },
) {
  const map = await ComputerDriver.call<ScreenMap>(
    "see",
    {
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
      hwnd: workingIn.get(sessionID),
      skip: "opencode",
      pids: PIDS,
      image: options.image,
      settle: options.settle ?? 0,
      ocr: "auto",
    },
    20_000,
  )
  const entries = book(sessionID).assign(map)
  const kept = ComputerScreen.keep(map, entries, SCREEN_LIMIT)
  const size = frame(display)
  let attachment: Attachment | undefined
  if (options.image) {
    const marks = options.marks
      ? entries
          .filter((entry) => kept.has(entry) && entry.item.mark)
          .map((entry) => ({ ref: entry.ref, x: entry.item.x, y: entry.item.y, w: entry.item.w, h: entry.item.h }))
      : []
    attachment = await shoot((file) =>
      ComputerDriver.call("draw", {
        path: file,
        targetWidth: size.width,
        targetHeight: size.height,
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
        marks,
      }),
    )
  }
  const notes = [
    `front: ${ComputerScreen.describeWindow(map.front)}`,
    ...(map.partial ? ["map cut short by a slow app"] : []),
    ...(map.ocr !== "ok" && map.ocr !== "off" ? [`text recognition ${map.ocr}`] : []),
  ]
  const text = `display ${index} ${size.width}x${size.height} · ${notes.join(" · ")}\n${ComputerScreen.format(map, entries, kept, { toFrame: (x, y) => toFrame(display, x, y) })}`
  return { map, entries, attachment, text }
}

export type Context = {
  readonly sessionID: string
  /** Asks the user to allow `computer` on these resources (an app, "screen", "clipboard"); rejects when refused. */
  readonly ask: (resources: string[], metadata: Record<string, unknown>) => Promise<void>
  readonly aborted: () => boolean
}

export type Result =
  | { readonly title: string; readonly output: string; readonly attachments: Attachment[] }
  /** The user refused a permission prompt; the host re-raises its own error so the run stops like any tool's. */
  | { readonly rejected: true }

// Each step runs in order; a failing step ends the call with what the earlier steps did plus the error.
export async function execute(params: Params, ctx: Context): Promise<Result> {
  let rejection = false
  const ask = (patterns: string[], metadata: Record<string, unknown>) =>
    ctx.ask(patterns, metadata).catch((error: unknown) => {
      rejection = true
      throw error
    })

  const own = (window: WindowInfo) =>
    /opencode/.test(window.process.toLowerCase()) || window.pid === process.pid || window.pid === process.ppid
  const guard = async (action: Action, window: WindowInfo | null, modifiers?: string) => {
    if (!window) return ask(["screen"], { action })
    const app = window.process.toLowerCase()
    if (own(window))
      throw new Error(
        action === "type" || action === "key" || action === "hold_key"
          ? "OpenCode is the focused window, so keys would go into it. Click the field in the app first, in the same call: actions [left_click, type], or use set_value"
          : "OpenCode cannot control its own window",
      )
    if (TERMINALS.has(app) && (!POINTER_ONLY.includes(action) || modifiers))
      throw new Error(
        `${window.process} is a terminal or IDE: only plain clicks and scrolling are allowed there. Use the shell or edit tools instead`,
      )
    workingIn.set(ctx.sessionID, window.hwnd)
    return ask([app], { action, app: window.process, title: window.title })
  }

  const at = (x: number, y: number) => ComputerDriver.call<WindowInfo | null>("window_at", { x, y })
  const foreground = () => ComputerDriver.call<WindowInfo | null>("foreground")
  const attachments: Attachment[] = []
  const output: string[] = []
  const refs = book(ctx.sessionID)
  // "Don't use my cursor" from the Mod settings, read once per call so a change applies on the next one.
  let background = false
  const noCursor = (what: string) =>
    new Error(
      `${what}, and "Don't use my cursor" is on in Settings, so the mouse is never moved. Use click_element, set_value, type with ref, or key instead`,
    )

  const entryFor = (ref: number) => {
    const entry = refs.get(ref)
    if (!entry) throw new Error(`There is no element [${ref}]; take a screenshot or read_window for current refs`)
    return entry
  }
  const show = (entry: Entry, display: Display) =>
    ComputerScreen.line(entry, { toFrame: (x, y) => toFrame(display, x, y) }, true)

  // Where an element is right now. Controls are looked up again by their accessibility id and OCR text is
  // read again around its last spot, so an action never lands where something used to be.
  const locate = async (entry: Entry, display: Display) => {
    const item = entry.item
    const spot = await ComputerDriver.call<{
      found: boolean
      closed?: boolean
      x: number
      y: number
      w: number
      h: number
      covered: boolean
      enabled: boolean
      top: WindowInfo | null
    }>("resolve", {
      src: item.src,
      hwnd: item.win,
      rid: item.rid,
      name: item.name,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      dx: display.x,
      dy: display.y,
      dw: display.width,
      dh: display.height,
    })
    if (!spot.found)
      throw new Error(
        `${show(entry, display)} is no longer on screen${spot.closed ? " (its window closed)" : ""}; look again`,
      )
    return { ...spot, cx: spot.x + Math.floor(spot.w / 2), cy: spot.y + Math.floor(spot.h / 2) }
  }

  // The physical point a pointer step aims at: an element's current centre, a coordinate, or the cursor.
  const pointOf = async (
    display: Display,
    ref: number | undefined,
    coordinate: readonly number[] | undefined,
    name = "coordinate",
  ) => {
    if (ref === undefined) {
      if (coordinate) return toPhysical(display, coordinate, name)
      return ComputerDriver.call<{ x: number; y: number }>("cursor")
    }
    const entry = entryFor(ref)
    const spot = await locate(entry, display)
    if (spot.covered)
      throw new Error(
        `${show(entry, display)} is covered by ${ComputerScreen.describeWindow(spot.top)}, so the mouse would land there. Use click_element (it presses controls in the background) or switch_window first`,
      )
    return { x: spot.cx, y: spot.cy }
  }

  // What a pointer action at this spot lands on, so a click that hits the wrong thing shows up at once.
  const hit = async (x: number, y: number) => {
    const found = await ComputerDriver.call<{ type: string; name: string; ctx: string } | null>("hit", {
      x,
      y,
    }).catch(() => null)
    if (!found) return ""
    return ` -> ${found.type} "${found.name}"${found.ctx ? ` in "${found.ctx}"` : ""}`
  }

  const windowOf = async (entry: Entry) =>
    refs.windows.get(entry.item.win) ?? (await at(entry.item.x + entry.item.w / 2, entry.item.y + entry.item.h / 2))

  // Finds the element a text names: the working app first (quick and the likeliest place), then the whole
  // display including OCR text. Several equally good matches are an error listing them, never a guess.
  const named = async (query: string, display: Display, index: number, only?: (entry: Entry) => boolean) => {
    const filter = (entries: Entry[]) => (only ? entries.filter(only) : entries)
    const app = await ComputerDriver.call<ScreenMap>(
      "see",
      {
        scope: "window",
        hwnd: workingIn.get(ctx.sessionID),
        skip: "opencode",
        pids: PIDS,
        ocr: "auto",
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
      },
      12_000,
    ).catch(() => undefined)
    let match = app
      ? ComputerScreen.find(filter(refs.assign(app)), query, app.target?.hwnd)
      : { candidates: [] as Entry[] }
    if (!match.entry && match.candidates.length === 0) {
      const screen = await look(ctx.sessionID, display, index, { image: false, marks: false })
      match = ComputerScreen.find(filter(screen.entries), query, screen.map.target?.hwnd)
    }
    if (!match.entry && match.candidates.length > 1)
      throw new Error(
        `"${query}" matches ${match.candidates.length} elements; pass ref to pick one:\n${match.candidates
          .slice(0, 8)
          .map((entry) => show(entry, display))
          .join("\n")}`,
      )
    return match.entry
  }

  const run = async (step: StepParams): Promise<string> => {
    if (step.device !== undefined)
      return ComputerAndroid.run(step, {
        sessionID: ctx.sessionID,
        refs,
        ask,
        attach: (attachment) => attachments.push(attachment),
      })
    const { display, index } = await target(ctx.sessionID, step.display)
    ComputerAurora.hold(ctx.sessionID, display, workingIn.get(ctx.sessionID))
    const action = step.action
    if (background) {
      // A plain click on a listed element is pressed through accessibility instead, which needs no mouse.
      if (action === "left_click" && step.ref !== undefined && !step.text)
        return run({ ...step, action: "click_element" })
      if (MOUSE.has(action)) throw noCursor(`${action} moves the mouse`)
    }
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
        const shot = await look(ctx.sessionID, display, index, { image: true, marks: step.marks ?? true })
        attachments.push(shot.attachment!)
        return shot.text
      }
      case "zoom": {
        await ask(["screen"], { action })
        const area = await (async () => {
          if (step.ref !== undefined) {
            const spot = await locate(entryFor(step.ref), display)
            const pad = Math.max(40, Math.round(Math.max(spot.w, spot.h) * 0.25))
            return { x: spot.x - pad, y: spot.y - pad, width: spot.w + pad * 2, height: spot.h + pad * 2 }
          }
          const region = step.region
          if (!region || region.length !== 4) throw new Error("region must be [x0, y0, x1, y1], or pass ref")
          const a = toPhysical(display, [region[0], region[1]], "region")
          const b = toPhysical(display, [region[2], region[3]], "region")
          return {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            width: Math.max(1, Math.abs(b.x - a.x)),
            height: Math.max(1, Math.abs(b.y - a.y)),
          }
        })()
        const shot = await capture(display, area)
        attachments.push(shot.attachment)
        return `zoom ${shot.width}x${shot.height} (coordinates still use the full display frame)`
      }
      case "cursor_position": {
        const point = await ComputerDriver.call<{ x: number; y: number }>("cursor")
        return contains(display, point.x, point.y)
          ? `cursor @${toFrame(display, point.x, point.y)}`
          : "cursor is on another display"
      }
      case "read_window": {
        await ask(["screen"], { action })
        const hwnd = step.coordinate
          ? (await at(...(Object.values(toPhysical(display, step.coordinate)) as [number, number])))?.hwnd
          : workingIn.get(ctx.sessionID)
        const map = await ComputerDriver.call<ScreenMap>(
          "see",
          {
            scope: "window",
            hwnd,
            skip: "opencode",
            pids: PIDS,
            ocr: "auto",
            x: display.x,
            y: display.y,
            width: display.width,
            height: display.height,
          },
          15_000,
        )
        if (map.target && !own(map.target)) workingIn.set(ctx.sessionID, map.target.hwnd)
        const entries = refs.assign(map)
        const list = await screens()
        const cx = map.area.x + map.area.w / 2
        const cy = map.area.y + map.area.h / 2
        const home = Math.max(
          0,
          list.findIndex((item) => contains(item, cx, cy)),
        )
        const screen = list[home] ?? display
        current.set(ctx.sessionID, home)
        const wanted = step.text ? ComputerScreen.fold(step.text) : ""
        const shown = wanted
          ? entries.filter(
              (entry) =>
                ComputerScreen.fold(`${entry.item.name} ${entry.item.value ?? ""} ${entry.item.ctx}`).includes(
                  wanted,
                ) || ComputerScreen.like(ComputerScreen.fold(entry.item.name), wanted),
            )
          : entries
        const window = ComputerScreen.describeWindow(map.target)
        if (shown.length === 0)
          return `${window}: no readable elements${step.text ? ` matching "${step.text}"` : ""}; take a screenshot`
        return `${window} on display ${home}:\n${ComputerScreen.format(map, shown, ComputerScreen.keep(map, shown, WINDOW_LIMIT), { toFrame: (x, y) => toFrame(screen, x, y) }, true)}`
      }
      case "click_element": {
        await ask(["screen"], { action })
        if (step.ref === undefined && !step.text) throw new Error("click_element needs ref or text")
        let entry = step.ref !== undefined ? entryFor(step.ref) : await named(step.text!, display, index)
        const hwnd = workingIn.get(ctx.sessionID)
        if (!entry && hwnd) {
          // Not on screen: a list row scrolled out of view is found by its exact name in the app, scrolled
          // into view, and then looked up again like anything else on screen.
          const spot = await ComputerDriver.call<{ found: boolean }>("resolve", {
            src: "uia",
            hwnd,
            name: step.text,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
          }).catch(() => ({ found: false }))
          if (spot.found) entry = await named(step.text!, display, index)
        }
        if (!entry) throw new Error(`No element matching "${step.text}" on screen; take a screenshot`)
        const item = entry.item
        if (item.state.includes("disabled")) throw new Error(`${show(entry, display)} is disabled`)
        const activate = (force: boolean) =>
          ComputerDriver.call<{ invoked: boolean; via?: string; mouse?: boolean }>(
            "invoke",
            {
              hwnd: item.win,
              rid: item.rid,
              name: item.name,
              x: item.x + item.w / 2,
              y: item.y + item.h / 2,
              force,
            },
            6_000,
          ).catch(() => ({ invoked: false, via: undefined, mouse: false }))
        let mouse = false
        if (item.src === "uia") {
          await guard("left_click", await windowOf(entry))
          // Accessibility activation works on the app's own control tree, so it leaves the user's cursor
          // alone and works even when the app is behind other windows. A real click is only the fallback.
          const activated = await activate(false)
          if (activated.invoked) return `pressed ${show(entry, display)} (${activated.via}, mouse not moved)`
          mouse = !!activated.mouse
        }
        if (background) {
          // Rows that would rather get a real click are pressed through accessibility anyway.
          const forced = mouse ? await activate(true) : undefined
          if (forced?.invoked) return `pressed ${show(entry, display)} (${forced.via}, mouse not moved)`
          throw noCursor(`${show(entry, display)} has no accessible action`)
        }
        // OCR text, controls without an accessible action and rows that need a real click get one where
        // they are now.
        const spot = await locate(entry, display)
        if (spot.covered && mouse) {
          const activated = await activate(true)
          if (activated.invoked)
            return `pressed ${show(entry, display)} (${activated.via}; it is covered, so the app may not react as to a click)`
        }
        if (spot.covered)
          throw new Error(
            `${show(entry, display)} has no accessible action and ${ComputerScreen.describeWindow(spot.top)} covers it, so a mouse click would hit that instead. Use switch_window first`,
          )
        await guard("left_click", spot.top ?? (await at(spot.cx, spot.cy)))
        await ComputerDriver.call("click", { x: spot.cx, y: spot.cy, button: "left", count: 1 })
        return `clicked ${show(entry, display)} with the mouse`
      }
      case "set_value": {
        await ask(["screen"], { action })
        if (step.value === undefined) throw new Error("set_value needs value")
        if (step.ref === undefined && !step.text) throw new Error("set_value needs ref or text")
        const entry =
          step.ref !== undefined
            ? entryFor(step.ref)
            : await named(step.text!, display, index, (e) => e.item.src === "uia" && SETTABLE.has(e.item.type))
        if (!entry) throw new Error(`No field matching "${step.text}"; take a screenshot`)
        if (entry.item.src !== "uia")
          throw new Error(`${show(entry, display)} is text on screen, not a field: click it and type instead`)
        await guard("type", await windowOf(entry))
        const item = entry.item
        const result = await ComputerDriver.call<string>(
          "set_value",
          {
            hwnd: item.win,
            rid: item.rid,
            name: item.name,
            x: item.x + item.w / 2,
            y: item.y + item.h / 2,
            value: step.value,
          },
          10_000,
        )
        return `set ${show(entry, display)} -> ${result}`
      }
      case "wait_for": {
        await ask(["screen"], { action })
        if (!step.text) throw new Error("wait_for needs text")
        const seconds = Math.min(Math.max(step.duration ?? 10, 0.1), 60)
        const result = await ComputerDriver.call<{ met: boolean; via?: string; ms: number }>(
          "wait_for",
          {
            query: step.text,
            gone: step.gone ?? false,
            timeout: seconds * 1000,
            hwnd: workingIn.get(ctx.sessionID),
            skip: "opencode",
            pids: PIDS,
            x: display.x,
            y: display.y,
            width: display.width,
            height: display.height,
          },
          seconds * 1000 + 15_000,
        )
        const took = (result.ms / 1000).toFixed(1)
        if (!result.met)
          throw new Error(`"${step.text}" ${step.gone ? "was still there" : "did not appear"} after ${seconds}s`)
        return step.gone ? `"${step.text}" went away after ${took}s` : `found ${result.via} after ${took}s`
      }
      case "watch": {
        await ask(["screen"], { action })
        const hwnd = workingIn.get(ctx.sessionID)
        const seconds = Math.min(Math.max(step.duration ?? 10, 1), 120)
        const wanted = step.text ? ComputerScreen.fold(step.text) : ""
        const lines = async () => {
          const map = await ComputerDriver.call<ScreenMap>(
            "see",
            {
              scope: "window",
              hwnd,
              skip: "opencode",
              pids: PIDS,
              ocr: "auto",
              x: display.x,
              y: display.y,
              width: display.width,
              height: display.height,
            },
            15_000,
          )
          const text = map.items
            .map((item) => [item.name, item.value].filter(Boolean).join(" ").trim())
            .filter((line) => line && (!wanted || ComputerScreen.fold(line).includes(wanted)))
          return { window: ComputerScreen.describeWindow(map.target), text }
        }
        const key = `${ctx.sessionID}:${hwnd ?? 0}:${wanted}`
        // The first watch of a window records what is there now; only text that shows up after counts.
        let seen: Set<string> = watched.get(key) ?? new Set((await lines()).text)
        watched.set(key, seen)
        const end = Date.now() + seconds * 1000
        for (;;) {
          const now = await lines()
          const fresh = now.text.filter((line) => !seen.has(line))
          for (const line of now.text) seen.add(line)
          if (seen.size > 5000) watched.set(key, (seen = new Set(now.text)))
          if (fresh.length) return `New in ${now.window}:\n${fresh.map((line) => `- ${line}`).join("\n")}`
          if (Date.now() > end) return `Nothing new in ${now.window} in ${seconds}s. Call watch again to keep waiting.`
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
      case "switch_window": {
        if (!step.text) throw new Error("switch_window needs the window title or app name in text")
        await ask(["screen"], { action })
        const window = await ComputerDriver.call<WindowInfo & { front: boolean }>("switch", {
          query: step.text,
          skip: "opencode",
          pids: PIDS,
        })
        workingIn.set(ctx.sessionID, window.hwnd)
        return window.front
          ? `switched to ${ComputerScreen.describeWindow(window)}`
          : `Windows kept ${ComputerScreen.describeWindow(window)} behind the current window; it is still the app read_window and click_element use`
      }
      case "mouse_move": {
        const point = await pointOf(display, step.ref, step.coordinate)
        await guard(action, await at(point.x, point.y))
        await ComputerDriver.call("move", point)
        return `moved to @${toFrame(display, point.x, point.y)}`
      }
      case "left_click":
      case "right_click":
      case "middle_click":
      case "double_click":
      case "triple_click": {
        const point = await pointOf(display, step.ref, step.coordinate)
        const window = await at(point.x, point.y)
        await guard(action, window, step.text)
        const landed = await hit(point.x, point.y)
        await ComputerDriver.call("click", {
          ...point,
          button: action === "right_click" ? "right" : action === "middle_click" ? "middle" : "left",
          count: action === "double_click" ? 2 : action === "triple_click" ? 3 : 1,
          modifiers: step.text ?? "",
        })
        return `${action} @${toFrame(display, point.x, point.y)} on ${ComputerScreen.describeWindow(window)}${landed}`
      }
      case "left_click_drag": {
        const from = await pointOf(display, step.start_ref, step.start_coordinate, "start_coordinate")
        const to = await pointOf(display, step.ref, step.coordinate)
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
        const point = await pointOf(display, step.ref, step.coordinate)
        const window = await at(point.x, point.y)
        await guard(action, window)
        await ComputerDriver.call("scroll", {
          ...point,
          direction: step.scroll_direction ?? "down",
          amount: Math.min(Math.max(Math.round(step.scroll_amount ?? 3), 1), 30),
        })
        return `scrolled ${step.scroll_direction ?? "down"} on ${ComputerScreen.describeWindow(window)}`
      }
      case "type":
      case "key":
      case "hold_key": {
        if (!step.text) throw new Error(`${action} needs text`)
        if (step.ref !== undefined && background) {
          // Focus the field through accessibility rather than clicking it.
          const entry = entryFor(step.ref)
          if (entry.item.src !== "uia") throw noCursor(`${show(entry, display)} is text on screen, not a field`)
          await guard("type", await windowOf(entry))
          const item = entry.item
          await ComputerDriver.call(
            "focus",
            { hwnd: item.win, rid: item.rid, name: item.name, x: item.x + item.w / 2, y: item.y + item.h / 2 },
            6_000,
          )
          await new Promise((resolve) => setTimeout(resolve, 60))
        } else if (step.ref !== undefined) {
          // Typing into an element clicks it first, so the keys go to that field and not to OpenCode.
          const point = await pointOf(display, step.ref, undefined)
          await guard("left_click", await at(point.x, point.y))
          await ComputerDriver.call("click", { ...point, button: "left", count: 1 })
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
        const window = await foreground()
        await guard(action, window)
        if (action === "type") await ComputerDriver.call("type", { text: step.text }, 120_000)
        else if (action === "key") await ComputerDriver.call("key", { keys: step.text })
        else await ComputerDriver.call("hold", { keys: step.text, ms: Math.min(step.duration ?? 1, 10) * 1000 }, 15_000)
        return `${action} into ${ComputerScreen.describeWindow(window)}`
      }
      case "wait": {
        const ms = Math.min(Math.max(step.duration ?? 1, 0), 10) * 1000
        await new Promise((resolve) => setTimeout(resolve, ms))
        // Models trained on other harnesses pause after every action out of habit, which costs a model turn
        // each time; the reminder in the result steers the rest of the run away from it.
        if (ms < 1000) return `waited ${ms / 1000}s`
        return `waited ${ms / 1000}s. Skip wait next time: actions already return their screenshot once the screen settles, and wait_for or watch return the moment something appears`
      }
      case "open_application": {
        if (!step.text) throw new Error("open_application needs the app name in text")
        await ask([`open:${step.text.toLowerCase()}`], { action, app: step.text })
        const opened = await ComputerDriver.call<string>("open", { name: step.text })
        // The new app opens on top, so the next read should go to it rather than the previous app.
        workingIn.delete(ctx.sessionID)
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
  const failure = await (async () => {
    background = (await ComputerAurora.load()).background
    for (const [i, step] of steps.entries()) {
      if (ctx.aborted()) return "aborted"
      const result = await run(step).then(
        (text) => ({ text }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      )
      if (rejection) return "rejected"
      // The step may have moved to another app (switch_window, open_application, a click in it).
      if (step.device === undefined) {
        const now = await target(ctx.sessionID).catch(() => undefined)
        if (now) ComputerAurora.hold(ctx.sessionID, now.display, workingIn.get(ctx.sessionID))
      }
      if ("error" in result)
        return steps.length > 1 ? `step ${i + 1} (${step.action}) failed: ${result.error}` : result.error
      output.push(steps.length > 1 ? `${i + 1}. ${result.text}` : result.text)
    }
    const last = steps.at(-1)!
    if ((params.screenshot_after ?? CHANGES_SCREEN.has(last.action)) && last.action !== "screenshot") {
      await ask(["screen"], { action: "screenshot" }).catch(() => {})
      if (rejection) return "rejected"
      if (last.device !== undefined) {
        output.push(
          await ComputerAndroid.run(
            { ...last, action: "screenshot" },
            {
              sessionID: ctx.sessionID,
              refs,
              ask,
              attach: (attachment) => attachments.push(attachment),
              settle: true,
            },
          ),
        )
        return undefined
      }
      // A short pause lets the app start reacting, then the frame is taken once the screen stops changing.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const { display, index } = await target(ctx.sessionID)
      const shot = await look(ctx.sessionID, display, index, {
        image: true,
        marks: params.marks ?? true,
        settle: 700,
      })
      attachments.push(shot.attachment!)
      output.push(shot.text)
    }
    return undefined
  })()
  if (rejection) return { rejected: true }
  if (failure && output.length === 0) throw new Error(failure)

  return {
    title: steps.length > 1 ? `${steps.length} desktop actions` : params.action,
    output: [...output, ...(failure ? [failure] : [])].join("\n"),
    attachments,
  }
}
