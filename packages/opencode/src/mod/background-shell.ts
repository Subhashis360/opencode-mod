import { spawn, spawnSync, type ChildProcess } from "child_process"
import { createWriteStream } from "fs"
import { mkdir, readFile } from "fs/promises"
import os from "os"
import path from "path"
import { randomUUID } from "crypto"

// OpenCode Mod: shell commands that keep running after the tool call returns (dev servers, long
// builds, watchers). The agent is woken when the command exits, or once when a line matches
// `notifyOn`, so it never has to sleep or poll.

export type Job = {
  id: string
  command: string
  cwd: string
  sessionID: string
  started: number
  status: "running" | "exited" | "stopped"
  code?: number | null
  log: string
}

type Live = Job & { child: ChildProcess; tail: string[] }

const TAIL = 20
const jobs = new Map<string, Live>()

function argv(shell: string, command: string): [string, string[]] {
  const name = path
    .basename(shell)
    .toLowerCase()
    .replace(/\.exe$/, "")
  if (name === "powershell" || name === "pwsh") return [shell, ["-NoProfile", "-NonInteractive", "-Command", command]]
  if (name === "cmd") return [shell, ["/d", "/s", "/c", command]]
  return [shell, ["-c", command]]
}

function kill(job: Live) {
  if (job.child.exitCode !== null || !job.child.pid) return
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(job.child.pid), "/T", "/F"], { windowsHide: true })
  else
    try {
      process.kill(-job.child.pid, "SIGTERM")
    } catch {
      job.child.kill("SIGTERM")
    }
}

process.once("exit", () => {
  for (const job of jobs.values()) kill(job)
})

export async function start(input: {
  shell: string
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  sessionID: string
  notifyOn?: string
  wake: (text: string) => void
}) {
  const pattern = input.notifyOn ? new RegExp(input.notifyOn) : undefined
  const dir = path.join(os.tmpdir(), "opencode-background")
  await mkdir(dir, { recursive: true })
  const id = `job_${randomUUID().slice(0, 8)}`
  const log = path.join(dir, `${id}.log`)
  const out = createWriteStream(log)
  const [file, args] = argv(input.shell, input.command)
  const child = spawn(file, args, {
    cwd: input.cwd,
    env: input.env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const job: Live = {
    id,
    command: input.command,
    cwd: input.cwd,
    sessionID: input.sessionID,
    started: Date.now(),
    status: "running",
    log,
    child,
    tail: [],
  }
  jobs.set(id, job)

  let partial = ""
  let matched = false
  const onData = (chunk: Buffer) => {
    out.write(chunk)
    const lines = (partial + chunk.toString()).split(/\r?\n/)
    partial = lines.pop() ?? ""
    for (const line of lines) {
      job.tail.push(line)
      if (job.tail.length > TAIL) job.tail.shift()
      if (pattern && !matched && pattern.test(line)) {
        matched = true
        input.wake(
          `Background job ${id} printed a line matching /${input.notifyOn}/ and is still running:\n${line}\nCommand: ${input.command}\nFull output: ${log}`,
        )
      }
    }
  }
  child.stdout?.on("data", onData)
  child.stderr?.on("data", onData)
  child.on("error", (error) => onData(Buffer.from(`\n${error.message}\n`)))
  child.on("close", (code) => {
    if (partial) job.tail.push(partial)
    out.end()
    const stopped = job.status === "stopped"
    job.status = stopped ? "stopped" : "exited"
    job.code = code
    if (stopped) return
    const seconds = Math.round((Date.now() - job.started) / 1000)
    input.wake(
      [
        `Background job ${id} finished with exit code ${code} after ${seconds}s.`,
        `Command: ${input.command}`,
        "Last output:",
        job.tail.join("\n") || "(no output)",
        `Full output: ${log}`,
      ].join("\n"),
    )
  })
  return job as Job
}

export const list = (sessionID?: string): Job[] =>
  [...jobs.values()]
    .filter((job) => !sessionID || job.sessionID === sessionID)
    .map(({ child: _child, tail: _tail, ...job }) => job)

export async function output(id: string, lines = 50) {
  const job = jobs.get(id)
  if (!job) throw new Error(`No background job ${id}`)
  const text = await readFile(job.log, "utf8").catch(() => "")
  return text.split(/\r?\n/).slice(-lines).join("\n")
}

export function stop(id: string) {
  const job = jobs.get(id)
  if (!job) throw new Error(`No background job ${id}`)
  if (job.status !== "running") return false
  job.status = "stopped"
  kill(job)
  return true
}

export * as BackgroundShell from "./background-shell"
