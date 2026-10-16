import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "fs/promises"
import os from "os"
import { ModHooks } from "../../src/mod/hooks"
import { ModMemory } from "../../src/mod/memory"
import { BackgroundShell } from "../../src/mod/background-shell"

const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh"

describe("hooks", () => {
  afterEach(() => rm(ModHooks.file(), { force: true }))

  test("save validates, fills defaults and round-trips", async () => {
    const saved = await ModHooks.save([
      { id: "", name: " ", event: "PreToolUse", matcher: " bash ", command: "echo hi", enabled: true },
    ])
    expect(saved[0].id).toBeTruthy()
    expect(saved[0].name).toBe("PreToolUse")
    expect(saved[0].matcher).toBe("bash")
    expect(saved[0].timeout).toBe(30)
    expect(await ModHooks.list()).toEqual(saved)
    await expect(
      ModHooks.save([{ id: "", name: "x", event: "PreToolUse", command: " ", enabled: true }]),
    ).rejects.toThrow("command")
  })

  test("a PreToolUse hook that exits 2 blocks the tool with its stderr", async () => {
    const block =
      process.platform === "win32"
        ? `$i = [Console]::In.ReadToEnd() | ConvertFrom-Json; [Console]::Error.WriteLine("no " + $i.input.command); exit 2`
        : `cat >/dev/null; echo "no rm" >&2; exit 2`
    await ModHooks.save([
      { id: "", name: "guard", event: "PreToolUse", matcher: "bash", command: block, enabled: true },
    ])
    const hooks = await ModHooks.HooksPlugin({ directory: os.tmpdir() } as never)
    await expect(
      hooks["tool.execute.before"]!({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "rm" } }),
    ).rejects.toThrow('Blocked by hook "guard": no rm')
    // Other tools do not match.
    await hooks["tool.execute.before"]!({ tool: "read", sessionID: "s", callID: "c" }, { args: {} })
  })

  test("UserPromptSubmit output is added to the prompt as context", async () => {
    await ModHooks.save([
      { id: "", name: "ctx", event: "UserPromptSubmit", command: "echo extra-context", enabled: true },
    ])
    const hooks = await ModHooks.HooksPlugin({ directory: os.tmpdir() } as never)
    const output = { message: { id: "msg_1" }, parts: [{ type: "text", text: "hello" }] } as never as Parameters<
      NonNullable<(typeof hooks)["chat.message"]>
    >[1]
    await hooks["chat.message"]!({ sessionID: "s" }, output)
    expect(JSON.stringify(output.parts)).toContain("extra-context")
  })
})

describe("memory", () => {
  afterEach(() => rm(ModMemory.file(), { force: true }))

  test("saves global and project facts and shows only the relevant ones", async () => {
    const global = await ModMemory.save({ text: "Prefers  short answers", scope: "global" })
    expect(global.text).toBe("Prefers short answers")
    await ModMemory.save({ text: "Uses pnpm", scope: "project", project: "/work/a" })
    await ModMemory.save({ text: "Uses yarn", scope: "project", project: "/work/b" })
    const here = await ModMemory.relevant("/work/a")
    expect(here.map((entry) => entry.text).toSorted()).toEqual(["Prefers short answers", "Uses pnpm"])
    expect(ModMemory.prompt(here)).toContain("<memory>")

    await ModMemory.save({ id: global.id, text: "Prefers detailed answers", scope: "global" })
    expect((await ModMemory.load()).entries.find((entry) => entry.id === global.id)?.text).toBe(
      "Prefers detailed answers",
    )
    expect(await ModMemory.remove(global.id)).toBe(true)
    await expect(ModMemory.save({ text: "x".repeat(600), scope: "global" })).rejects.toThrow("under")
  })

  test("the plugin adds memories to the system prompt unless turned off", async () => {
    await ModMemory.save({ text: "Never push without asking", scope: "global" })
    const hooks = await ModMemory.MemoryPlugin({ directory: os.tmpdir() } as never)
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({} as never, output)
    expect(output.system.join("\n")).toContain("Never push without asking")
    await ModMemory.setEnabled(false)
    const off = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({} as never, off)
    expect(off.system).toEqual([])
  })
})

describe("background shell", () => {
  test("wakes the agent when the command prints a match and when it exits", async () => {
    const wakes: string[] = []
    const command =
      process.platform === "win32"
        ? "Write-Output 'server ready'; Start-Sleep -Milliseconds 300; Write-Output done"
        : "echo server ready; sleep 0.3; echo done"
    const job = await BackgroundShell.start({
      shell,
      command,
      cwd: os.tmpdir(),
      env: process.env,
      sessionID: "ses_bg",
      notifyOn: "ready",
      wake: (text) => wakes.push(text),
    })
    expect(job.status).toBe("running")
    for (let i = 0; i < 100 && wakes.length < 2; i++) await Bun.sleep(100)
    expect(wakes[0]).toContain("matching /ready/")
    expect(wakes[1]).toContain("finished with exit code 0")
    expect(wakes[1]).toContain("done")
    expect(await BackgroundShell.output(job.id)).toContain("server ready")
    expect(BackgroundShell.list("ses_bg")[0].status).toBe("exited")
  }, 20_000)

  test("stop ends a running job without waking the agent", async () => {
    const wakes: string[] = []
    const job = await BackgroundShell.start({
      shell,
      command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30",
      cwd: os.tmpdir(),
      env: process.env,
      sessionID: "ses_stop",
      wake: (text) => wakes.push(text),
    })
    await Bun.sleep(300)
    expect(BackgroundShell.stop(job.id)).toBe(true)
    for (let i = 0; i < 50 && BackgroundShell.list("ses_stop")[0].status === "running"; i++) await Bun.sleep(100)
    expect(BackgroundShell.list("ses_stop")[0].status).toBe("stopped")
    await Bun.sleep(300)
    expect(wakes).toEqual([])
  }, 20_000)
})
