#!/usr/bin/env bun
// Builds the OpenCode Mod installer for this platform. With --release it also publishes the
// artifacts as a GitHub release, which installed copies pick up through the auto-updater.
import { $ } from "bun"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import pkg from "../package.json"

const REPO = "Subhashis360/opencode-mod"
const ROOT = join(import.meta.dir, "../../..")
const release = process.argv.includes("--release")

// Mod versions encode the upstream version plus a mod revision as major.minor.(patch*100+revision),
// so 1.18.2901 is upstream 1.18.29 with mod revision 1. The number always grows, both for a
// mod-only release and for a newer upstream, which is what the auto-updater compares.
const [major, minor, patch] = pkg.version.split(".").map(Number)
const modVersion = (revision: number) => `${major}.${minor}.${patch * 100 + revision}`

async function nextVersion() {
  if (Bun.env.OPENCODE_MOD_VERSION) return Bun.env.OPENCODE_MOD_VERSION
  if (!release) return modVersion(0)
  const tags = (await $`gh release list --repo ${REPO} --limit 200 --json tagName --jq .[].tagName`.text()).split(
    /\r?\n/,
  )
  let revision = 0
  while (tags.includes(`v${modVersion(revision)}`)) revision++
  if (revision > 99) throw new Error(`no mod revisions left for upstream ${pkg.version}`)
  return modVersion(revision)
}

// Release notes are the section of MOD-CHANGELOG.md for this upstream version.
async function releaseNotes() {
  const changelog = await Bun.file(join(ROOT, ".github/MOD-CHANGELOG.md")).text()
  const start = changelog.indexOf(`## ${pkg.version}`)
  if (start === -1) throw new Error(`.github/MOD-CHANGELOG.md has no "## ${pkg.version}" section`)
  const next = changelog.indexOf("\n## ", start + 1)
  return changelog.slice(start, next === -1 ? undefined : next).trim()
}

const version = await nextVersion()
const notes = release ? await releaseNotes() : ""
const env = { ...process.env, OPENCODE_MOD: "1", OPENCODE_CHANNEL: "prod", OPENCODE_MOD_VERSION: version }
const target = process.platform === "win32" ? "--win" : process.platform === "darwin" ? "--mac" : "--linux"

await $`rm -rf dist`
await $`bun ./scripts/prebuild.ts`.env(env)
await $`bunx electron-vite build`.env(env)
await $`bunx electron-builder ${target} --config electron-builder.config.ts --publish never`.env(env)

// The updater needs the installer, its blockmap and latest*.yml from the same build.
const files = (await readdir("dist"))
  .filter((file) => file.startsWith("opencode-mod-") || /^latest.*\.yml$/.test(file))
  .map((file) => join("dist", file))
if (!files.some((file) => file.endsWith(".yml"))) throw new Error("electron-builder did not write latest*.yml")
console.log(`Built OpenCode Mod ${version}:\n${files.join("\n")}`)

if (release) {
  await $`gh release create v${version} ${files} --repo ${REPO} --title ${`OpenCode Mod ${version}`} --notes ${notes}`
  console.log(`Released v${version}: https://github.com/${REPO}/releases/tag/v${version}`)
}
