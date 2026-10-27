import { mkdir, open, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// OpenCode's global folders, as @opencode/util/global finds them. Both the server part and the desktop main process
// read these, and the GUI bundle cannot import OpenCode's own util package.
const home = os.homedir()
const root = (env: string | undefined, ...fallback: string[]) => path.join(env || path.join(home, ...fallback), "opencode")

export const Path = {
  get data() {
    return root(process.env.XDG_DATA_HOME, ".local", "share")
  },
  get config() {
    return process.env.OPENCODE_CONFIG_DIR ?? root(process.env.XDG_CONFIG_HOME, ".config")
  },
  get state() {
    return root(process.env.XDG_STATE_HOME, ".local", "state")
  },
}

const STALE = 60_000

/** Runs `fn` while holding a lock file, shared by every process on this machine. A lock older than a minute is taken over. */
export async function withLock<T>(name: string, fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const dir = path.join(Path.state, "locks")
  const file = path.join(dir, `${name}.lock`)
  const deadline = Date.now() + timeoutMs

  await mkdir(dir, { recursive: true })

  for (;;) {
    try {
      const handle = await open(file, "wx")
      await handle.writeFile(String(process.pid))
      await handle.close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const age = await stat(file).then((info) => Date.now() - info.mtimeMs, () => 0)
      if (age > STALE) {
        await rm(file, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the ${name} lock`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  try {
    return await fn()
  } finally {
    await rm(file, { force: true })
  }
}
