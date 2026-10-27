import { spawn, type ChildProcess } from "child_process"
import { createInterface } from "readline"
import { createHash } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import HELPER from "./windows-helper.txt"
import HOST from "./windows-host.txt"
import SEE from "./windows-see.txt"
import OCR from "./windows-ocr.txt"
import AURORA from "./windows-aurora.txt"

// One long-lived helper process serves every computer-use action. It compiles its native calls
// once and then answers each request over stdin/stdout in a few milliseconds.

export type Display = { x: number; y: number; width: number; height: number; primary: boolean; name: string }
export type WindowInfo = { hwnd: number; pid: number; process: string; title: string }
// One entry of the screen map. The rectangle is in physical screen pixels.
export type Item = {
  src: "uia" | "ocr"
  type: string
  name: string
  value?: string
  state: string[]
  x: number
  y: number
  w: number
  h: number
  win: number
  ctx: string
  mark: boolean
  rid?: string
}
export type ScreenMap = {
  area: { x: number; y: number; w: number; h: number }
  items: Item[]
  partial: boolean
  windows: WindowInfo[]
  front: WindowInfo | null
  target: WindowInfo | null
  ocr: string
  ms: number
}

const IDLE_MS = 5 * 60 * 1000
const READY_MS = 30 * 1000

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let helper: Promise<ChildProcess> | undefined
let sequence = 0
let idle: ReturnType<typeof setTimeout> | undefined
const pending = new Map<number, Pending>()

export function supported() {
  return process.platform === "win32"
}

export async function tempDir() {
  const dir = path.join(os.tmpdir(), "opencode-computer")
  await mkdir(dir, { recursive: true })
  return dir
}

const SOURCES = { "helper.ps1": HELPER, "host.cs": HOST, "see.cs": SEE, "ocr.cs": OCR, "aurora.cs": AURORA }

// The folder is named after a hash of the sources, so the DLLs the helper compiles there are reused until the
// code changes.
async function launch() {
  const hash = createHash("sha1")
  for (const text of Object.values(SOURCES)) hash.update(text)
  const dir = path.join(await tempDir(), `helper-${hash.digest("hex").slice(0, 12)}`)
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(SOURCES)) await writeFile(path.join(dir, name), text)
  const script = path.join(dir, "helper.ps1")
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  )
  let stderr = ""
  child.stderr?.on("data", (chunk) => (stderr = (stderr + String(chunk)).slice(-2000)))

  return new Promise<ChildProcess>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("The desktop helper did not start in time"))
    }, READY_MS)
    const lines = createInterface({ input: child.stdout! })
    lines.on("line", (line) => {
      const message = parse(line)
      if (!message) return
      if (message.ready) {
        clearTimeout(timer)
        resolve(child)
        return
      }
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.result)
      else entry.reject(new Error(message.error ?? "Desktop action failed"))
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      helper = undefined
      const error = new Error(`The desktop helper stopped (code ${code})${stderr ? `: ${stderr.trim()}` : ""}`)
      reject(error)
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(error)
        pending.delete(id)
      }
    })
  })
}

function parse(
  line: string,
): { ready?: boolean; id: number; ok?: boolean; result?: unknown; error?: string } | undefined {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

export function stop() {
  if (idle) clearTimeout(idle)
  idle = undefined
  const current = helper
  helper = undefined
  void current?.then((child) => child.kill()).catch(() => {})
}

process.once("exit", stop)

export async function call<T = unknown>(op: string, args: Record<string, unknown> = {}, timeout = 20_000): Promise<T> {
  if (!supported()) throw new Error("Computer use currently works on Windows only")
  helper ??= launch().catch((error) => {
    helper = undefined
    throw error
  })
  const child = await helper
  if (idle) clearTimeout(idle)
  idle = setTimeout(stop, IDLE_MS)
  idle.unref?.()
  const id = ++sequence
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Desktop action "${op}" timed out`))
    }, timeout)
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
    child.stdin!.write(JSON.stringify({ id, op, ...args }) + "\n")
  })
}

export * as ComputerDriver from "./driver"
