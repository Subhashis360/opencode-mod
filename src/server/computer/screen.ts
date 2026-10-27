import type { Item, ScreenMap, WindowInfo } from "./driver"

// The screen map as the model sees it: every element gets a [n] ref that stays the same for as long as the element
// is on screen, so a plan made from one look still points at the right things a few actions later, and the same
// number on the screenshot marks and in the text ties the picture to the list.

export type Entry = { ref: number; item: Item }

// Refs are never reused within a session: an old number from earlier in the conversation either still means the
// same element or is reported as gone, never silently points at something else.
const KEEP = 3000

export class Refs {
  private next = 1
  private keys = new Map<string, number>()
  private entries = new Map<number, Entry>()
  // Windows seen in any map, so an action on an older ref still knows which app it asks permission for.
  windows = new Map<number, WindowInfo>()

  assign(map: ScreenMap) {
    for (const window of [...map.windows, map.target, map.front]) if (window) this.windows.set(window.hwnd, window)
    if (this.windows.size > 200) this.windows = new Map([...this.windows].slice(-100))
    const seen = new Set<number>()
    const result: Entry[] = []
    for (const item of map.items) {
      const key = keyOf(item)
      let ref = this.keys.get(key)
      if (ref === undefined || seen.has(ref)) {
        ref = this.next++
        this.keys.set(key, ref)
      }
      seen.add(ref)
      const entry = { ref, item }
      // Re-inserting keeps the map in least-recently-seen order, so trimming drops what has been gone longest.
      this.entries.delete(ref)
      this.entries.set(ref, entry)
      result.push(entry)
    }
    for (const [ref, entry] of this.entries) {
      if (this.entries.size <= KEEP) break
      this.entries.delete(ref)
      this.keys.delete(keyOf(entry.item))
    }
    return result
  }

  get(ref: number) {
    return this.entries.get(ref)
  }
}

function keyOf(item: Item) {
  if (item.src === "uia" && item.rid) return `${item.win}|${item.rid}`
  const cx = item.x + item.w / 2
  const cy = item.y + item.h / 2
  return `${item.src}|${item.win}|${item.type}|${fold(item.name)}|${Math.round(cx / 32)}|${Math.round(cy / 32)}`
}

// Lowercase letters and digits only, with the glyphs OCR confuses merged, so "Log in", "LOGIN" and "Log1n" all
// match. The helper folds the same way.
export function fold(text: string) {
  let result = ""
  for (const raw of text.toLowerCase()) {
    const ch = raw === "0" ? "o" : raw === "1" || raw === "i" || raw === "|" || raw === "!" ? "l" : raw
    if (/[\p{L}\p{N}]/u.test(ch)) result += ch
  }
  return result
}

// Fuzzy matches are only for OCR misreads and never bridge different numbers: "Item 8" is not "Item 80".
function digits(text: string) {
  return text.replace(/\D/g, "")
}

// Same text give or take OCR misreads: at most a third of the letters differ.
export function like(a: string, b: string) {
  if (!a || !b || Math.abs(a.length - b.length) * 3 > Math.max(a.length, b.length)) return false
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length] * 3 <= Math.max(a.length, b.length)
}

const CLICKABLE = new Set([
  "button",
  "checkbox",
  "combobox",
  "edit",
  "hyperlink",
  "listitem",
  "menuitem",
  "radiobutton",
  "slider",
  "spinner",
  "splitbutton",
  "tabitem",
  "treeitem",
  "dataitem",
  "headeritem",
  "document",
])

export function clickable(item: Item) {
  return item.src === "ocr" || CLICKABLE.has(item.type)
}

export type Match = { entry?: Entry; candidates: Entry[] }

// Finds the element a text names. "Admin > Login" means the "Login" inside the group or window called "Admin".
// When several elements match equally well it refuses to guess and returns them all, so the model picks a ref
// instead of the tool pressing the wrong one of three "Login" buttons.
export function find(entries: Entry[], query: string, target?: number): Match {
  const parts = query.split(/\s+>\s+/)
  const wanted = fold(parts.at(-1)!)
  const within = parts.slice(0, -1).map(fold).filter(Boolean)
  if (!wanted) return { candidates: [] }
  const scored = entries.flatMap((entry) => {
    const item = entry.item
    if (within.length && !within.every((part) => fold(item.ctx).includes(part))) return []
    const name = fold(item.name)
    const value = fold(item.value ?? "")
    const rank =
      name === wanted
        ? 0
        : value === wanted
          ? 1
          : name.startsWith(wanted)
            ? 2
            : name.includes(wanted) || (wanted.length >= 3 && value.includes(wanted))
              ? 3
              : item.src === "ocr" && like(name, wanted) && digits(name) === digits(wanted)
                ? 4
                : -1
    if (rank < 0) return []
    const score = [
      rank,
      target !== undefined && item.win !== target ? 1 : 0,
      clickable(item) ? 0 : 1,
      item.state.includes("disabled") ? 1 : 0,
      item.state.includes("covered") ? 1 : 0,
    ]
    return [{ entry, score }]
  })
  const compare = (a: number[], b: number[]) => a.findIndex((x, i) => x !== b[i])
  scored.sort((a, b) => {
    const i = compare(a.score, b.score)
    return i < 0 ? a.entry.item.name.length - b.entry.item.name.length : a.score[i] - b.score[i]
  })
  const top = scored[0]
  if (!top) return { candidates: [] }
  const tied = scored.filter((s) => compare(s.score, top.score) < 0).map((s) => s.entry)
  if (tied.length > 1) return { candidates: tied }
  return { entry: top.entry, candidates: [top.entry] }
}

export type Frame = { toFrame: (x: number, y: number) => string }

export function describeWindow(window: WindowInfo | null | undefined) {
  if (!window) return "the desktop"
  if (!window.title) return window.process === "explorer" ? "taskbar" : window.process
  return `${window.process} "${window.title.slice(0, 60)}"`
}

export function line(entry: Entry, frame: Frame, withContext = false) {
  const item = entry.item
  const kind = item.src === "ocr" ? "ocr" : item.type
  const value = item.value ? ` ="${item.value}"` : ""
  const center = frame.toFrame(item.x + item.w / 2, item.y + item.h / 2)
  const state = item.state.length ? ` ${item.state.join(" ")}` : ""
  const context = withContext && item.ctx ? ` in "${item.ctx}"` : ""
  return `[${entry.ref}] ${kind} "${item.name}"${value} @${center}${state}${context}`
}

// Rough importance, so a busy screen keeps what the model is most likely to need: the app it works in first, then
// controls, then text, then other windows and the taskbar.
function priority(entry: Entry, target: number | undefined, front: number | undefined) {
  const item = entry.item
  const win = item.win === target ? 0 : item.win === front ? 1 : item.ctx === "taskbar" ? 3 : 2
  const kind = item.src === "uia" && CLICKABLE.has(item.type) ? 0 : item.src === "ocr" ? 1 : 2
  return win * 3 + kind
}

// The elements a busy screen has room for. The screenshot marks only these, so every number on the picture is
// also in the text.
export function keep(map: ScreenMap, entries: Entry[], limit: number) {
  return new Set(
    entries
      .map((entry, index) => ({ entry, index, rank: priority(entry, map.target?.hwnd, map.front?.hwnd) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, limit)
      .map((x) => x.entry),
  )
}

// The map as indented text: windows, then the named groups inside them, each element in reading order. Grouping is
// what tells three "Login" buttons apart at a glance. A single window's map leaves out the window line.
export function format(map: ScreenMap, entries: Entry[], kept: Set<Entry>, frame: Frame, single = false) {
  const target = map.target?.hwnd
  const front = map.front?.hwnd
  const windows = new Map<number, WindowInfo>(map.windows.map((w) => [w.hwnd, w]))
  const groups = new Map<number, Map<string, Entry[]>>()
  for (const entry of entries) {
    if (!kept.has(entry)) continue
    const byContext = groups.get(entry.item.win) ?? new Map<string, Entry[]>()
    groups.set(entry.item.win, byContext)
    const list = byContext.get(entry.item.ctx) ?? []
    byContext.set(entry.item.ctx, list)
    list.push(entry)
  }
  const order = [...groups.keys()].sort((a, b) => rankWindow(a) - rankWindow(b))
  function rankWindow(win: number) {
    if (win === target) return 0
    if (win === front) return 1
    const index = map.windows.findIndex((w) => w.hwnd === win)
    return index < 0 ? 999 : index + 2
  }
  const out: string[] = []
  const flat = single && order.length === 1
  for (const win of order) {
    const byContext = groups.get(win)!
    const first = [...byContext.values()][0]?.[0]
    const name = first?.item.ctx === "taskbar" && byContext.size === 1 ? "taskbar" : describeWindow(windows.get(win))
    if (!flat) out.push(`${name}${win === front ? " (front)" : ""}:`)
    const base = flat ? "" : "  "
    const contexts = [...byContext.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0))
    for (const context of contexts) {
      const grouped = context !== "" && context !== "taskbar"
      if (grouped) out.push(`${base}${context}:`)
      for (const entry of byContext.get(context)!.toSorted(reading))
        out.push(base + (grouped ? "  " : "") + line(entry, frame))
    }
  }
  const hidden = entries.length - kept.size
  if (hidden > 0) out.push(`(${hidden} more not listed; read_window or a text filter shows them)`)
  // Indented as a block, so the history can drop old maps while keeping what each action did.
  return out.map((text) => `  ${text}`).join("\n")
}

// Rows first (elements whose centres are within a few pixels share a row), then left to right.
function reading(a: Entry, b: Entry) {
  const ay = a.item.y + a.item.h / 2
  const by = b.item.y + b.item.h / 2
  if (Math.abs(ay - by) > Math.min(a.item.h, b.item.h) / 2) return ay - by
  return a.item.x - b.item.x
}

export * as ComputerScreen from "./screen"
