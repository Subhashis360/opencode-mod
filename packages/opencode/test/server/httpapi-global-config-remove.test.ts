import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

const file = path.join(Global.Path.config, "opencode.jsonc")

afterEach(async () => {
  await fs.rm(file, { force: true })
  await disposeAllInstances()
  await resetDatabase()
})

function remove(keyPath: string[]) {
  return Server.Default().app.request("/global/config/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: keyPath }),
  })
}

describe("POST /global/config/remove", () => {
  test("deletes one entry and keeps its siblings and comments", async () => {
    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(
      file,
      `{
  // my agents
  "agent": {
    "recon": { "description": "Recon", "prompt": "map the attack surface" },
    "review": { "description": "Review", "prompt": "review the diff" }
  }
}
`,
    )

    const response = await remove(["agent", "recon"])

    expect(response.status).toBe(200)
    const text = await fs.readFile(file, "utf8")
    expect(text).toContain("// my agents")
    expect(text).not.toContain("recon")
    expect(text).toContain("review the diff")
  })

  test("deletes a single model from a provider", async () => {
    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        provider: { local: { npm: "@ai-sdk/openai-compatible", models: { a: { name: "A" }, b: { name: "B" } } } },
      }),
    )

    const response = await remove(["provider", "local", "models", "a"])

    expect(response.status).toBe(200)
    const stored = JSON.parse(await fs.readFile(file, "utf8"))
    expect(stored.provider.local.models).toEqual({ b: { name: "B" } })
  })

  test("rejects paths outside the removable collections", async () => {
    expect((await remove(["model"])).status).toBe(400)
    expect((await remove(["agent"])).status).toBe(400)
  })
})
