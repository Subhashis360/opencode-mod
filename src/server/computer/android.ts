import { spawn } from "child_process"
import { existsSync } from "fs"
import { readFile, rm, writeFile } from "fs/promises"
import path from "path"
import { ComputerDriver, type Item, type ScreenMap, type WindowInfo } from "./driver"
import { ComputerScreen, type Entry } from "./screen"
import type { Attachment, StepParams } from "./tool.js"

// Android phones and emulators over adb, with the same screen map as the desktop: the phone's own accessibility
// tree (uiautomator) gives every control with its text, state and exact bounds, OCR of the screencap adds text
// that games and web views draw themselves, and each element gets a [n] ref the model taps by number.

export type Context = {
  sessionID: string
  refs: ComputerScreen.Refs
  ask: (patterns: string[], metadata: Record<string, unknown>) => Promise<unknown>
  attach: (attachment: Attachment) => void
  settle?: boolean
}

type Device = { serial: string; width: number; height: number; model: string; win: number }

const MAX_EDGE = 1280
const MAX_PIXELS = 1_000_000
const LIMIT = 150

const KEYCODES: Record<string, number> = {
  home: 3,
  back: 4,
  call: 5,
  endcall: 6,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  center: 23,
  volumeup: 24,
  volumedown: 25,
  power: 26,
  camera: 27,
  tab: 61,
  space: 62,
  enter: 66,
  return: 66,
  backspace: 67,
  menu: 82,
  search: 84,
  mediaplaypause: 85,
  pageup: 92,
  pagedown: 93,
  escape: 111,
  esc: 111,
  delete: 112,
  del: 112,
  ctrl: 113,
  control: 113,
  shift: 59,
  alt: 57,
  movehome: 122,
  moveend: 123,
  volumemute: 164,
  appswitch: 187,
  recents: 187,
  notifications: 83,
  wakeup: 224,
  sleep: 223,
}

const TYPES: [RegExp, string][] = [
  [/EditText|AutoCompleteTextView|SearchView/, "edit"],
  [/CheckBox|Switch|ToggleButton|CheckedTextView/, "checkbox"],
  [/RadioButton/, "radiobutton"],
  [/ImageButton|Button|FloatingActionButton|Chip/, "button"],
  [/Spinner/, "combobox"],
  [/SeekBar|Slider|RatingBar/, "slider"],
  [/ProgressBar/, "progressbar"],
  [/RecyclerView|ListView|GridView|ScrollView|ViewPager|NestedScrollView/, "list"],
  [/TabWidget|TabLayout/, "tab"],
  [/WebView/, "document"],
  [/ImageView/, "image"],
  [/TextView/, "text"],
]

const devices = new Map<string, Device>()

function adbPath() {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  const candidates = [
    home && path.join(home, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
  ].filter((item): item is string => !!item)
  return candidates.find((item) => existsSync(item)) ?? "adb"
}

function adb(args: string[], timeout = 15_000) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(adbPath(), args, { windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`adb ${args.slice(2, 4).join(" ")} timed out`))
    }, timeout)
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on("data", (chunk) => (stderr = (stderr + String(chunk)).slice(-1000)))
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("adb was not found; install Android platform-tools or set ANDROID_HOME")
          : error,
      )
    })
    child.once("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(stderr.trim() || `adb exited with code ${code}`))
    })
  })
}

const shell = (device: Device, command: string, timeout?: number) =>
  adb(["-s", device.serial, "shell", command], timeout).then(String)

async function listDevices() {
  const text = String(await adb(["devices", "-l"]))
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      serial: parts[0],
      state: parts[1],
      model: parts.find((part) => part.startsWith("model:"))?.slice(6) ?? "",
    }))
}

async function device(requested: string): Promise<Device> {
  const cached = devices.get(requested)
  if (cached) return cached
  const list = await listDevices()
  const ready = list.filter((item) => item.state === "device")
  const found =
    requested === "android"
      ? ready.length === 1
        ? ready[0]
        : undefined
      : list.find((item) => item.serial === requested)
  if (!found) {
    if (requested === "android" && ready.length > 1)
      throw new Error(
        `Several phones are connected; pass device as one of: ${ready.map((item) => item.serial).join(", ")}`,
      )
    throw new Error(
      list.length
        ? `No usable phone "${requested}": ${list.map((item) => `${item.serial} (${item.state})`).join(", ")}`
        : "No phone is connected over adb; plug one in with USB debugging on, or start an emulator",
    )
  }
  if (found.state !== "device")
    throw new Error(`Phone ${found.serial} is ${found.state}; accept the USB debugging prompt on it`)
  const size = (await shell({ serial: found.serial } as Device, "wm size")).match(
    /(?:Override|Physical) size: (\d+)x(\d+)/g,
  )
  const last = size?.at(-1)?.match(/(\d+)x(\d+)/)
  if (!last) throw new Error("Could not read the phone's screen size")
  let win = 0
  for (const ch of found.serial) win = (win * 31 + ch.charCodeAt(0)) | 0
  const result = {
    serial: found.serial,
    width: Number(last[1]),
    height: Number(last[2]),
    model: found.model.replace(/_/g, " "),
    // Negative window ids keep each phone's refs apart from desktop windows and from each other.
    win: -Math.abs(win || 1),
  }
  devices.set(requested, result)
  devices.set(found.serial, result)
  return result
}

function frame(device: Device, width = device.width, height = device.height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)))
  return { scale, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function toPhysical(device: Device, point: readonly number[] | undefined, name = "coordinate") {
  if (!point || point.length !== 2) throw new Error(`${name} must be [x, y]`)
  const { scale, width, height } = frame(device)
  const x = Math.min(Math.max(point[0], 0), width - 1)
  const y = Math.min(Math.max(point[1], 0), height - 1)
  return { x: Math.round(x / scale), y: Math.round(y / scale) }
}

function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

type Node = { attrs: Record<string, string>; children: Node[] }

// uiautomator's XML is flat and regular, so a small tag scanner is enough and avoids a parser dependency.
function parse(xml: string) {
  const root: Node = { attrs: {}, children: [] }
  const stack = [root]
  for (const match of xml.matchAll(/<(\/?)node\b([^>]*?)(\/?)>/g)) {
    if (match[1]) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[attr[1]] = decode(attr[2])
    const node = { attrs, children: [] }
    stack.at(-1)!.children.push(node)
    if (!match[3]) stack.push(node)
  }
  return root
}

function bounds(node: Node) {
  const match = node.attrs.bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  if (!match) return undefined
  const [x1, y1, x2, y2] = match.slice(1).map(Number)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function kind(node: Node) {
  const cls = node.attrs.class ?? ""
  for (const [pattern, type] of TYPES) if (pattern.test(cls)) return type
  if (node.attrs.clickable === "true" || node.attrs["long-clickable"] === "true") return "button"
  return node.attrs.scrollable === "true" ? "list" : "group"
}

function texts(node: Node, limit = 3): string[] {
  const own = node.attrs.text || node.attrs["content-desc"] || ""
  const result = own ? [own] : []
  for (const child of node.children) {
    if (result.length >= limit) break
    result.push(...texts(child, limit - result.length))
  }
  return result
}

// The phone's tree as map items. A tappable row usually has no text of its own (its labels are children), so it
// is named after the text inside it, and those labels are then not listed again.
function items(xml: string, device: Device) {
  const result: Item[] = []
  const walk = (node: Node, context: string, owner: string) => {
    const box = bounds(node)
    const type = kind(node)
    const attrs = node.attrs
    const id = attrs["resource-id"]?.split("/").at(-1) ?? ""
    const tappable = attrs.clickable === "true" || attrs["long-clickable"] === "true" || attrs.checkable === "true"
    const editable = type === "edit"
    const own = attrs["content-desc"] || (editable ? "" : attrs.text) || ""
    const name = (
      own ||
      (tappable ? texts(node).join(" ") : "") ||
      (tappable || editable ? (id ? `#${id}` : "") : "")
    ).trim()
    let nextContext = context
    let nextOwner = owner
    if (box && box.w > 2 && box.h > 2 && attrs.package) {
      const scrollable = attrs.scrollable === "true"
      const show = tappable || editable || scrollable || (!!name && name !== owner && !owner.includes(name))
      if (show) {
        const state: string[] = []
        if (attrs.enabled === "false") state.push("disabled")
        if (attrs.focused === "true") state.push("focused")
        if (attrs.checkable === "true") state.push(attrs.checked === "true" ? "checked" : "unchecked")
        if (attrs.selected === "true") state.push("selected")
        if (attrs.password === "true") state.push("password")
        if (scrollable) state.push("scrollable")
        const value = editable && attrs.password !== "true" ? attrs.text : undefined
        result.push({
          src: "uia",
          type: tappable && type === "text" ? "button" : type,
          name: (name || (editable ? "text field" : scrollable ? id || "scroll area" : "")).slice(0, 120),
          ...(value && value !== name ? { value: value.slice(0, 120) } : {}),
          state,
          ...box,
          win: device.win,
          ctx: context,
          mark: tappable || editable,
        })
        if (tappable) nextOwner = name
      }
      if ((scrollable || type === "tab") && (attrs["content-desc"] || id)) nextContext = attrs["content-desc"] || id
    }
    for (const child of node.children) walk(child, nextContext, nextOwner)
  }
  walk(parse(xml), "", "")
  return result
}

async function dump(device: Device) {
  const read = async () => {
    const out = String(await adb(["-s", device.serial, "exec-out", "uiautomator dump --compressed /dev/tty"], 20_000))
    const end = out.lastIndexOf("</hierarchy>")
    if (end < 0) throw new Error(out.trim().slice(0, 200) || "uiautomator returned nothing")
    return out.slice(out.indexOf("<?xml") >= 0 ? out.indexOf("<?xml") : 0, end + "</hierarchy>".length)
  }
  // The dump fails while the screen animates ("could not get idle state"); one retry usually lands after it.
  return read().catch(() => new Promise((resolve) => setTimeout(resolve, 300)).then(read))
}

async function foreground(device: Device): Promise<WindowInfo> {
  const text = await shell(device, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'").catch(() => "")
  const match = text.match(/([\w.]+)\/([\w.$]+)/)
  return { hwnd: device.win, pid: 0, process: match?.[1] ?? device.model, title: match?.[2] ?? "" }
}

// One look at the phone: screencap and the accessibility tree are fetched at the same time, OCR adds drawn text
// the tree does not have, and every element gets its ref.
async function look(device: Device, ctx: Context, options: { image: boolean; marks: boolean; ocr: boolean }) {
  const started = Date.now()
  const png = path.join(await ComputerDriver.tempDir(), `phone-${process.pid}-${Date.now()}.png`)
  // The screencap is written to `png`; only its completion matters here.
  const [xml, , app] = await Promise.all([
    dump(device).catch((error: Error) => error),
    options.image || options.ocr
      ? adb(["-s", device.serial, "exec-out", "screencap -p"], 20_000).then((bytes) => writeFile(png, bytes))
      : Promise.resolve(undefined),
    foreground(device),
  ])
  try {
    const tree = typeof xml === "string" ? items(xml, device) : []
    let ocr = "off"
    const found: Item[] = []
    if (options.ocr && ComputerDriver.supported()) {
      const phrases = await ComputerDriver.call<{ text: string; x: number; y: number; w: number; h: number }[]>(
        "read_image",
        { src: png, scale: 1 },
        15_000,
      ).then(
        (list) => ((ocr = "ok"), list),
        (error: Error) => ((ocr = error.message), []),
      )
      for (const phrase of phrases) {
        const cx = phrase.x + phrase.w / 2
        const cy = phrase.y + phrase.h / 2
        const folded = ComputerScreen.fold(phrase.text)
        if (!folded) continue
        const said = tree.some((item) => {
          const inside = cx >= item.x && cy >= item.y && cx < item.x + item.w && cy < item.y + item.h
          if (!inside) return false
          const name = ComputerScreen.fold(`${item.name} ${item.value ?? ""}`)
          return (
            (item.type !== "list" && item.type !== "document") ||
            name.includes(folded) ||
            ComputerScreen.like(folded, name)
          )
        })
        if (!said)
          found.push({
            src: "ocr",
            type: "text",
            name: phrase.text,
            state: [],
            ...phrase,
            win: device.win,
            ctx: "",
            mark: true,
          })
      }
    }
    const map: ScreenMap = {
      area: { x: 0, y: 0, w: device.width, h: device.height },
      items: [...tree, ...found],
      partial: false,
      windows: [app],
      front: app,
      target: app,
      ocr,
      ms: Date.now() - started,
    }
    const entries = ctx.refs.assign(map)
    const kept = ComputerScreen.keep(map, entries, LIMIT)
    const size = frame(device)
    if (options.image) {
      const jpg = png.replace(/\.png$/, ".jpg")
      const marks = options.marks
        ? entries.filter((e) => kept.has(e) && e.item.mark).map((e) => ({ ref: e.ref, ...pick(e.item) }))
        : []
      if (ComputerDriver.supported()) {
        await ComputerDriver.call("image", {
          src: png,
          path: jpg,
          targetWidth: size.width,
          targetHeight: size.height,
          marks,
        })
        ctx.attach(await encode(jpg, "image/jpeg"))
      } else ctx.attach(await encode(png, "image/png", false))
    }
    const notes = [
      `${device.model || device.serial} ${size.width}x${size.height}`,
      `app: ${app.process}${app.title ? `/${app.title}` : ""}`,
      ...(typeof xml === "string" ? [] : [`controls unreadable (${xml.message.slice(0, 80)})`]),
      ...(ocr !== "ok" && ocr !== "off" ? [`text recognition ${ocr}`] : []),
    ]
    const toFrame = (x: number, y: number) => `${Math.round(x * size.scale)},${Math.round(y * size.scale)}`
    return {
      entries,
      text: `phone ${notes.join(" · ")}\n${ComputerScreen.format(map, entries, kept, { toFrame }, true) || "(no elements found)"}`,
      toFrame,
    }
  } finally {
    // Both the capture and the converted picture go, even when a step failed halfway.
    await rm(png, { force: true })
    await rm(png.replace(/\.png$/, ".jpg"), { force: true })
  }
}

function pick(item: Item) {
  return { x: item.x, y: item.y, w: item.w, h: item.h }
}

async function encode(file: string, mime: string, remove = true) {
  const bytes = await readFile(file).finally(() => (remove ? rm(file, { force: true }) : undefined))
  const attachment: Attachment = { type: "file", mime, uri: `data:${mime};base64,${bytes.toString("base64")}` }
  return attachment
}

// `input text` goes through the phone's shell: spaces become %s and shell characters are escaped. It only types
// ASCII, so anything else is refused rather than typed wrong.
function quote(text: string) {
  if (/[^\x20-\x7e]/.test(text))
    throw new Error("adb can only type plain ASCII text; type other characters with the phone's keyboard")
  return text.replace(/([\\'"`$&|;<>()*~?!#\[\]{}^])/g, "\\$1").replace(/ /g, "%s")
}

async function typeText(device: Device, text: string) {
  const lines = text.split("\n")
  for (const [i, part] of lines.entries()) {
    if (part) await shell(device, `input text ${quote(part)}`, 60_000)
    if (i < lines.length - 1) await shell(device, "input keyevent 66")
  }
}

function keycode(name: string) {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[_\- ]/g, "")
    .replace(/^keycode/, "")
  if (key in KEYCODES) return KEYCODES[key]
  if (/^\d+$/.test(key)) return Number(key)
  if (/^[a-z]$/.test(key)) return 29 + key.charCodeAt(0) - 97
  if (/^[0-9]$/.test(name.trim())) return 7 + Number(name.trim())
  if (/^f([1-9]|1[0-2])$/.test(key)) return 131 + Number(key.slice(1)) - 1
  throw new Error(`Unknown phone key: ${name}`)
}

const center = (item: { x: number; y: number; w: number; h: number }) => ({
  x: Math.round(item.x + item.w / 2),
  y: Math.round(item.y + item.h / 2),
})

export async function run(step: StepParams, ctx: Context): Promise<string> {
  const action = step.action
  if (action === "list_displays") {
    const list = await listDevices()
    if (!list.length) return "No phones connected over adb"
    return list.map((item) => `${item.serial} ${item.state}${item.model ? ` ${item.model}` : ""}`).join("\n")
  }
  const phone = await device(step.device ?? "android")
  const allow = (metadata: Record<string, unknown>) =>
    ctx.ask([`android:${phone.serial}`], { action, device: phone.model || phone.serial, ...metadata })
  const entryFor = (ref: number) => {
    const entry = ctx.refs.get(ref)
    if (!entry || entry.item.win !== phone.win)
      throw new Error(`There is no element [${ref}] on this phone; take a screenshot for current refs`)
    return entry
  }
  const label = (entry: Entry) =>
    ComputerScreen.line(
      entry,
      { toFrame: (x, y) => `${Math.round(x * frame(phone).scale)},${Math.round(y * frame(phone).scale)}` },
      true,
    )
  // Text lookups read the tree fresh (without a screenshot), because phone screens change under every tap.
  const named = async (query: string, only?: (entry: Entry) => boolean) => {
    const seen = await look(phone, ctx, { image: false, marks: false, ocr: true })
    const match = ComputerScreen.find(only ? seen.entries.filter(only) : seen.entries, query, phone.win)
    if (match.entry) return match.entry
    if (match.candidates.length > 1)
      throw new Error(
        `"${query}" matches ${match.candidates.length} elements; pass ref to pick one:\n${match.candidates.slice(0, 8).map(label).join("\n")}`,
      )
    throw new Error(`No element matching "${query}" on the phone; take a screenshot`)
  }
  const pointOf = (ref: number | undefined, coordinate: readonly number[] | undefined, name = "coordinate") => {
    if (ref !== undefined) return center(entryFor(ref).item)
    if (coordinate) return toPhysical(phone, coordinate, name)
    return { x: Math.round(phone.width / 2), y: Math.round(phone.height / 2) }
  }

  switch (action) {
    case "screenshot":
    case "read_window": {
      await allow({})
      if (ctx.settle) await new Promise((resolve) => setTimeout(resolve, 350))
      const seen = await look(phone, ctx, {
        image: action === "screenshot",
        marks: step.marks ?? true,
        ocr: action === "screenshot",
      })
      return seen.text
    }
    case "zoom": {
      await allow({})
      const area = step.ref !== undefined ? entryFor(step.ref).item : undefined
      const region = area
        ? { x: area.x - 40, y: area.y - 40, w: area.w + 80, h: area.h + 80 }
        : (() => {
            if (!step.region || step.region.length !== 4)
              throw new Error("region must be [x0, y0, x1, y1], or pass ref")
            const a = toPhysical(phone, [step.region[0], step.region[1]], "region")
            const b = toPhysical(phone, [step.region[2], step.region[3]], "region")
            return {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              w: Math.abs(b.x - a.x) || 1,
              h: Math.abs(b.y - a.y) || 1,
            }
          })()
      const png = path.join(await ComputerDriver.tempDir(), `phone-zoom-${process.pid}-${Date.now()}.png`)
      await writeFile(png, await adb(["-s", phone.serial, "exec-out", "screencap -p"], 20_000))
      const size = frame(phone, region.w, region.h)
      const jpg = png.replace(/\.png$/, ".jpg")
      try {
        await ComputerDriver.call("image", {
          src: png,
          path: jpg,
          targetWidth: size.width,
          targetHeight: size.height,
          cx: region.x,
          cy: region.y,
          cw: region.w,
          ch: region.h,
        })
      } catch (error) {
        await rm(jpg, { force: true })
        throw error
      } finally {
        await rm(png, { force: true })
      }
      ctx.attach(await encode(jpg, "image/jpeg"))
      return `zoom ${size.width}x${size.height} (coordinates still use the full phone frame)`
    }
    case "click_element":
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click": {
      const entry =
        action === "click_element"
          ? step.ref !== undefined
            ? entryFor(step.ref)
            : step.text
              ? await named(step.text)
              : undefined
          : step.ref !== undefined
            ? entryFor(step.ref)
            : undefined
      if (action === "click_element" && !entry) throw new Error("click_element needs ref or text")
      if (entry?.item.state.includes("disabled")) throw new Error(`${label(entry)} is disabled`)
      const point = entry ? center(entry.item) : pointOf(undefined, step.coordinate)
      await allow({ x: point.x, y: point.y })
      // A long press is a swipe that does not move; right_click means the same on a phone.
      const hold = action === "right_click" ? 800 : step.duration ? Math.min(step.duration, 10) * 1000 : 0
      const taps = action === "double_click" ? 2 : action === "triple_click" ? 3 : 1
      if (hold) await shell(phone, `input swipe ${point.x} ${point.y} ${point.x} ${point.y} ${hold}`, hold + 10_000)
      else await shell(phone, Array.from({ length: taps }, () => `input tap ${point.x} ${point.y}`).join(" && "))
      const what = hold ? "long-pressed" : taps === 2 ? "double-tapped" : taps === 3 ? "triple-tapped" : "tapped"
      return entry ? `${what} ${label(entry)}` : `${what} @${step.coordinate?.join(",") ?? "center"}`
    }
    case "left_click_drag":
    case "scroll": {
      await allow({})
      if (action === "left_click_drag") {
        const from = pointOf(step.start_ref, step.start_coordinate, "start_coordinate")
        const to = pointOf(step.ref, step.coordinate)
        if (step.start_ref === undefined && !step.start_coordinate)
          throw new Error("left_click_drag needs start_ref or start_coordinate")
        await shell(
          phone,
          `input swipe ${from.x} ${from.y} ${to.x} ${to.y} ${Math.round((step.duration ?? 0.6) * 1000)}`,
        )
        return `dragged to @${step.coordinate?.join(",") ?? `[${step.ref}]`}`
      }
      // Scrolling down moves the content up, so the finger travels up; each notch is about a seventh of the screen.
      const from = pointOf(step.ref, step.coordinate)
      const direction = step.scroll_direction ?? "down"
      const span = (direction === "up" || direction === "down" ? phone.height : phone.width) / 7
      const distance = Math.round(Math.min(Math.max(step.scroll_amount ?? 3, 1), 10) * span)
      const dx = direction === "left" ? distance : direction === "right" ? -distance : 0
      const dy = direction === "up" ? distance : direction === "down" ? -distance : 0
      const clamp = (value: number, max: number) => Math.min(Math.max(value, 10), max - 10)
      const start = { x: clamp(from.x - dx / 2, phone.width), y: clamp(from.y - dy / 2, phone.height) }
      const end = { x: clamp(from.x + dx / 2, phone.width), y: clamp(from.y + dy / 2, phone.height) }
      await shell(
        phone,
        `input swipe ${Math.round(start.x)} ${Math.round(start.y)} ${Math.round(end.x)} ${Math.round(end.y)} 350`,
      )
      return `scrolled ${direction}`
    }
    case "type": {
      if (!step.text) throw new Error("type needs text")
      if (step.ref !== undefined) {
        const point = center(entryFor(step.ref).item)
        await allow({})
        await shell(phone, `input tap ${point.x} ${point.y}`)
      } else await allow({})
      await typeText(phone, step.text)
      return `typed on the phone`
    }
    case "set_value": {
      if (step.value === undefined) throw new Error("set_value needs value")
      const entry =
        step.ref !== undefined
          ? entryFor(step.ref)
          : step.text
            ? await named(
                step.text,
                (e) => e.item.src === "uia" && ["edit", "checkbox", "radiobutton"].includes(e.item.type),
              )
            : undefined
      if (!entry) throw new Error("set_value needs ref or text")
      await allow({})
      const item = entry.item
      const point = center(item)
      if (item.state.includes("checked") || item.state.includes("unchecked")) {
        const on = ["true", "1", "on", "yes", "checked"].includes(step.value.trim().toLowerCase())
        if (item.state.includes("checked") !== on) await shell(phone, `input tap ${point.x} ${point.y}`)
        return `set ${label(entry)} -> ${on ? "checked" : "unchecked"}`
      }
      // Tap the field, jump to the end of what is there and delete it, then type the new text.
      await shell(phone, `input tap ${point.x} ${point.y}`)
      const old = item.value?.length ?? 0
      if (old) await shell(phone, `input keyevent 123 ${Array.from({ length: old + 2 }, () => "67").join(" ")}`)
      await typeText(phone, step.value)
      return `set ${label(entry)} -> "${item.state.includes("password") ? "(set)" : step.value}"`
    }
    case "key":
    case "hold_key": {
      if (!step.text) throw new Error(`${action} needs text`)
      await allow({})
      for (const combo of step.text.split(/\s+/).filter(Boolean)) {
        const keys = combo.split("+").map(keycode)
        if (action === "hold_key") await shell(phone, `input keyevent --longpress ${keys.join(" ")}`)
        else if (keys.length > 1) await shell(phone, `input keycombination ${keys.join(" ")}`)
        else await shell(phone, `input keyevent ${keys[0]}`)
      }
      return `${action} ${step.text} on the phone`
    }
    case "wait_for": {
      if (!step.text) throw new Error("wait_for needs text")
      await allow({})
      const wanted = ComputerScreen.fold(step.text)
      const seconds = Math.min(Math.max(step.duration ?? 10, 0.1), 60)
      const until = Date.now() + seconds * 1000
      const started = Date.now()
      while (true) {
        const xml = await dump(phone).catch(() => "")
        const present = ComputerScreen.fold(decode(xml)).includes(wanted)
        if (present !== (step.gone ?? false)) {
          const took = ((Date.now() - started) / 1000).toFixed(1)
          return step.gone ? `"${step.text}" went away after ${took}s` : `"${step.text}" appeared after ${took}s`
        }
        if (Date.now() >= until)
          throw new Error(`"${step.text}" ${step.gone ? "was still there" : "did not appear"} after ${seconds}s`)
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }
    case "open_application":
    case "switch_window": {
      if (!step.text) throw new Error(`${action} needs the app name or package in text`)
      const wanted = step.text.trim().toLowerCase()
      const packages = (await shell(phone, "pm list packages"))
        .split(/\r?\n/)
        .map((line) => line.replace(/^package:/, "").trim())
        .filter(Boolean)
      const found =
        packages.find((pkg) => pkg === wanted) ??
        packages.find((pkg) => pkg.split(".").at(-1) === wanted.replace(/\s+/g, "")) ??
        packages.find((pkg) => pkg.includes(wanted.replace(/\s+/g, "")))
      if (!found)
        throw new Error(`No app on the phone matches "${step.text}"; pass its package name, e.g. com.android.chrome`)
      await ctx.ask([`android:${phone.serial}`], { action, device: phone.model || phone.serial, app: found })
      await shell(phone, `monkey -p ${found} -c android.intent.category.LAUNCHER 1`)
      return `opened ${found} on the phone`
    }
    case "wait": {
      const ms = Math.min(Math.max(step.duration ?? 1, 0), 10) * 1000
      await new Promise((resolve) => setTimeout(resolve, ms))
      return `waited ${ms / 1000}s`
    }
  }
  throw new Error(
    `${action} is not available on a phone; use tap (left_click), swipe (left_click_drag), scroll, type and key`,
  )
}

export * as ComputerAndroid from "./android"
