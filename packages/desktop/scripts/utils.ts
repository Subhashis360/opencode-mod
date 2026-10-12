import { $ } from "bun"
import { chmod, copyFile, stat } from "node:fs/promises"
import { join } from "node:path"

// The opencode free tier refuses clients older than this. A source build on a feature branch
// is stamped 0.0.0-<branch>-<timestamp>, which falls below it.
const MIN_CLI_VERSION = [1, 18, 0] as const
const OPENCODE_DIR = join(import.meta.dir, "../../opencode")

function meetsMinimum(version: string) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return false
  const current = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (let i = 0; i < 3; i++) {
    if (current[i] !== MIN_CLI_VERSION[i]) return current[i] > MIN_CLI_VERSION[i]
  }
  return true
}

// The version the opencode server reports to the API: the checked-out package version, so a
// build always identifies as the upstream release its source is based on.
export async function opencodeVersion(): Promise<string> {
  const version = Bun.env.OPENCODE_VERSION ?? (await Bun.file(join(OPENCODE_DIR, "package.json")).json()).version
  if (!meetsMinimum(version)) {
    throw new Error(`opencode version ${version} is below ${MIN_CLI_VERSION.join(".")}, the free tier would reject it`)
  }
  return version
}

// Builds the server bundle the desktop app runs in-process. Without OPENCODE_VERSION the
// build stamps the branch-derived 0.0.0 version, which the free tier refuses.
export async function buildServerBundle() {
  const version = await opencodeVersion()
  // The desktop channel (dev/beta/prod) is not an opencode release channel; with it unset and a
  // real version, the server is stamped channel "latest" like an official release.
  const { OPENCODE_CHANNEL: _, ...env } = process.env
  await $`bun script/build-node.ts`.cwd(OPENCODE_DIR).env({ ...env, OPENCODE_VERSION: version })
  const bundle = await Bun.file(join(OPENCODE_DIR, "dist/node/node.js")).text()
  if (!bundle.includes(`"${version}"`) && !bundle.includes(`'${version}'`)) {
    throw new Error(`server bundle is not stamped with ${version}`)
  }
  console.log(`Built server bundle stamped ${version}`)
}

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export const CLI_BINARIES: Array<{ rustTarget: string; package: string; os: string; cpu: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    package: "@opencode-ai/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    package: "@opencode-ai/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.rustTarget === target)
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

export async function downloadCliToResources() {
  const dest = windowsify("resources/opencode-cli")

  // Keep an existing CLI only if the free tier will accept it; otherwise rebuild it.
  const existing = await stat(dest).catch(() => undefined)
  if (existing && existing.size > 0) {
    const current = await $`${dest} --version`
      .quiet()
      .text()
      .then((x) => x.trim())
      .catch(() => "")
    if (meetsMinimum(current)) {
      console.log(`CLI ${current} already at ${dest}, skipping`)
      return
    }
    console.log(`CLI at ${dest} is ${current || "unversioned"}, rebuilding from source`)
  }

  // Build from this checkout so local changes ship with the CLI, stamped with the
  // package version instead of the branch-derived 0.0.0 dev version.
  const cli = getCurrentCli()
  const version = await opencodeVersion()
  await $`bun script/build.ts --single --skip-install`
    .cwd(OPENCODE_DIR)
    .env({ ...process.env, OPENCODE_VERSION: version })
  const target = `opencode-${cli.os === "win32" ? "windows" : cli.os}-${cli.cpu}`
  await copyFile(join(OPENCODE_DIR, "dist", target, "bin", windowsify("opencode")), dest)
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Built opencode ${version} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
