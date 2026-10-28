export * as ModUpdater from "./updater"

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "jsonc-parser"
import { ModConfig } from "../server/config"
import type { Commit } from "./contract"

// Updates OpenCode Mod from its GitHub repository. A git clone (how the README installs it) is fast-forwarded, the same
// as `git pull`, and only when it has no commits of its own. Any other copy gets the changed built files downloaded,
// each checked against GitHub's hash before it replaces the old one.

export const REPO = "Subhashis360/opencode-mod"
const BRANCH = "main"
const GIT_URL = `https://github.com/${REPO}.git`
const API = `https://api.github.com/repos/${REPO}`
const RAW = `https://raw.githubusercontent.com/${REPO}`
const NAME = "opencode-mod"
/** In a downloaded copy, the commit its files came from. */
const MARKER = ".opencode-mod-commit"

export type Found = {
  phase: "current" | "available" | "diverged"
  method: "git" | "download"
  folder: string
  installed?: string
  latest: Commit
  behind?: number
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

async function packageName(dir: string) {
  const text = await readFile(path.join(dir, "package.json"), "utf8").catch(() => "")
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value.name : undefined
  } catch {
    return undefined
  }
}

/** A plugin entry that names a folder on this machine, resolved against the config's folder. */
function localPath(spec: string, base: string) {
  if (spec.startsWith("file:")) {
    try {
      return fileURLToPath(spec)
    } catch {
      return undefined
    }
  }
  if (spec === "~" || spec.startsWith("~/") || spec.startsWith("~\\")) return path.join(os.homedir(), spec.slice(1))
  if (path.isAbsolute(spec) || spec.startsWith(".")) return path.resolve(base, spec)
  return undefined
}

/** The plugin's folder: the entry of the global config's plugins list whose package is opencode-mod. */
export async function folder() {
  const file = ModConfig.file()
  const text = await readFile(file, "utf8").catch(() => "")
  const config: unknown = parse(text, [], { allowTrailingComma: true })
  const entries = isObject(config) ? [config.plugins, config.plugin].flatMap((list) => (Array.isArray(list) ? list : [])) : []
  let packaged = false

  for (const entry of entries) {
    const spec = typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : undefined
    if (!spec) continue
    const dir = localPath(spec, path.dirname(file))
    if (!dir) {
      if (spec === NAME || spec.startsWith(`${NAME}@`)) packaged = true
      continue
    }
    if ((await packageName(dir)) === NAME) return dir
  }

  if (packaged) throw new Error(`OpenCode Mod is installed as a package; update it with: npm install ${NAME}@latest`)
  throw new Error(`OpenCode Mod's folder is not in the plugins list of ${file}`)
}

type Result = { code: number | string | undefined; stdout: string; stderr: string }

function run(cwd: string, args: string[]) {
  return new Promise<Result>((resolve) =>
    execFile(
      "git",
      args,
      {
        cwd,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        // Never wait on a credential prompt nobody can see.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      },
      (error, stdout, stderr) =>
        resolve({ code: error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    ),
  )
}

async function git(cwd: string, args: string[]) {
  const result = await run(cwd, args)
  if (result.code === "ENOENT") throw new Error("Git is not installed or not on PATH, and this copy is a git clone")
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`)
  return result.stdout.trim()
}

async function checkGit(dir: string): Promise<Found> {
  const installed = await git(dir, ["rev-parse", "HEAD"])
  await git(dir, ["fetch", "--quiet", "--no-tags", GIT_URL, BRANCH])
  const [sha = "", date = "", ...subject] = (await git(dir, ["log", "-1", "--format=%H%n%cI%n%s", "FETCH_HEAD"])).split("\n")
  const latest = { sha, date, message: subject.join("\n") }
  const base = { method: "git" as const, folder: dir, installed, latest }

  if (installed === sha) return { ...base, phase: "current" }

  // Behind GitHub only: HEAD is in GitHub's history. A copy with its own commits is left alone.
  const ancestor = await run(dir, ["merge-base", "--is-ancestor", installed, sha])
  if (ancestor.code === 1) return { ...base, phase: "diverged" }
  if (ancestor.code !== 0) throw new Error(ancestor.stderr.trim() || "git merge-base failed")

  const behind = Number(await git(dir, ["rev-list", "--count", `${installed}..${sha}`]))
  return { ...base, phase: "available", ...(Number.isFinite(behind) ? { behind } : {}) }
}

async function installGit(dir: string): Promise<Found> {
  const found = await checkGit(dir)
  if (found.phase !== "available") return found
  await git(dir, ["merge", "--ff-only", "--quiet", found.latest.sha])
  const installed = await git(dir, ["rev-parse", "HEAD"])
  if (installed !== found.latest.sha) throw new Error("The update did not apply; run git pull in " + dir)
  return { ...found, phase: "current", installed, behind: 0 }
}

type Entry = { path: string; sha: string }

async function github<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "opencode-mod-updater" },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 403 || response.status === 429)
    throw new Error("GitHub's rate limit was reached; try again in an hour")
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`)
  return (await response.json()) as T
}

/** Git's id of a file's content, the same hash GitHub's tree lists. */
const blobSha = (bytes: Uint8Array) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")

/** What the app loads from the plugin: its package file and the built files. */
const shipped = (file: string) => file === "package.json" || file.startsWith("dist/")

const local = (dir: string, file: string) => path.join(dir, ...file.split("/"))

async function remote() {
  const commit = await github<{
    sha: string
    commit: { message: string; committer: { date: string }; tree: { sha: string } }
  }>(`${API}/commits/${BRANCH}`)
  const tree = await github<{ truncated: boolean; tree: { path: string; type: string; sha: string }[] }>(
    `${API}/git/trees/${commit.commit.tree.sha}?recursive=1`,
  )
  if (tree.truncated) throw new Error("GitHub returned a partial file list")
  const files: Entry[] = tree.tree.filter((item) => item.type === "blob" && shipped(item.path))
  if (!files.some((item) => item.path === "dist/server.js")) throw new Error("GitHub's copy has no built files")
  const [subject = ""] = commit.commit.message.split("\n")
  return { latest: { sha: commit.sha, date: commit.commit.committer.date, message: subject }, files }
}

async function changed(dir: string, files: readonly Entry[]) {
  const result: Entry[] = []
  for (const file of files) {
    const bytes = await readFile(local(dir, file.path)).catch(() => undefined)
    if (!bytes || blobSha(bytes) !== file.sha) result.push(file)
  }
  return result
}

async function marker(dir: string) {
  const text = await readFile(path.join(dir, MARKER), "utf8").catch(() => "")
  return /^[0-9a-f]{40}$/.test(text.trim()) ? text.trim() : undefined
}

async function checkDownload(dir: string): Promise<Found> {
  const { latest, files } = await remote()
  const diff = await changed(dir, files)
  const installed = diff.length ? await marker(dir) : latest.sha
  return {
    phase: diff.length ? "available" : "current",
    method: "download",
    folder: dir,
    latest,
    ...(installed ? { installed } : {}),
  }
}

async function installDownload(dir: string): Promise<Found> {
  const { latest, files } = await remote()
  const diff = await changed(dir, files)
  const temps: string[] = []

  try {
    // Every file is downloaded and checked before any is replaced, so a failure leaves the old version whole.
    for (const file of diff) {
      const response = await fetch(`${RAW}/${latest.sha}/${file.path}`, { signal: AbortSignal.timeout(120_000) })
      if (!response.ok) throw new Error(`Could not download ${file.path} (${response.status})`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (blobSha(bytes) !== file.sha) throw new Error(`${file.path} did not match GitHub's copy; nothing was changed`)
      const temp = `${local(dir, file.path)}.update-${process.pid}`
      await mkdir(path.dirname(temp), { recursive: true })
      await writeFile(temp, bytes)
      temps.push(temp)
    }
    for (const [index, file] of diff.entries()) await rename(temps[index]!, local(dir, file.path))
    temps.length = 0
  } finally {
    await Promise.all(temps.map((temp) => rm(temp, { force: true })))
  }

  await writeFile(path.join(dir, MARKER), `${latest.sha}\n`)
  return { phase: "current", method: "download", folder: dir, installed: latest.sha, latest }
}

const isClone = (dir: string) => existsSync(path.join(dir, ".git"))

/** Compares the folder with GitHub. */
export function check(dir: string) {
  return isClone(dir) ? checkGit(dir) : checkDownload(dir)
}

/** Brings the folder to GitHub's latest commit when it is behind; otherwise reports where it stands. */
export function install(dir: string) {
  return isClone(dir) ? installGit(dir) : installDownload(dir)
}
