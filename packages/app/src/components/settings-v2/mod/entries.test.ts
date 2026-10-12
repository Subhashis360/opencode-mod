import { describe, expect, test } from "bun:test"
import {
  compact,
  formatPairs,
  joinCommandLine,
  parsePairs,
  PERMISSION_PRESETS,
  permissionPatches,
  permissionValue,
  splitCommandLine,
  stalePaths,
} from "./entries"

describe("splitCommandLine", () => {
  test("splits on whitespace and keeps quoted arguments together", () => {
    expect(splitCommandLine(`npx -y "@scope/server" --root 'C:\\My Files'`)).toEqual([
      "npx",
      "-y",
      "@scope/server",
      "--root",
      "C:\\My Files",
    ])
  })

  test("keeps an explicitly empty argument", () => {
    expect(splitCommandLine(`cmd ""`)).toEqual(["cmd", ""])
  })

  test("round-trips through joinCommandLine", () => {
    const args = ["node", "server.js", "--name", "my server", `say "hi"`, ""]
    expect(splitCommandLine(joinCommandLine(args))).toEqual(args)
  })
})

describe("parsePairs", () => {
  test("parses pairs and ignores blank lines", () => {
    expect(parsePairs("A=1\n\n B = two=2 ", "=")).toEqual({ pairs: { A: "1", B: "two=2" }, invalidLine: undefined })
  })

  test("reports the first malformed line", () => {
    expect(parsePairs("Authorization: Bearer x\nno separator", ":").invalidLine).toBe(2)
    expect(parsePairs("=value", "=").invalidLine).toBe(1)
  })

  test("formats back to one pair per line", () => {
    expect(formatPairs({ Authorization: "Bearer x" }, ":")).toBe("Authorization: Bearer x")
    expect(formatPairs({ A: "1", B: "2" }, "=")).toBe("A=1\nB=2")
  })
})

describe("compact", () => {
  test("drops empty values and empty nested objects", () => {
    expect(compact({ a: "", b: undefined, c: 0, d: false, e: { f: "" }, g: { h: "x" } })).toEqual({
      c: 0,
      d: false,
      g: { h: "x" },
    })
  })
})

describe("stalePaths", () => {
  test("lists keys removed at any depth", () => {
    const before = { prompt: "p", model: "m", permission: { edit: "deny", bash: "ask" }, options: {} }
    const after = { prompt: "p", permission: { bash: "ask" } }
    expect(stalePaths(before, after)).toEqual([["model"], ["permission", "edit"], ["options"]])
  })

  test("does not descend into a value that changed type", () => {
    expect(stalePaths({ permission: { edit: "deny" } }, { permission: "allow" })).toEqual([])
  })
})

describe("permissionPatches", () => {
  test("writes the wildcard on its own before the specific tools", () => {
    expect(permissionPatches(PERMISSION_PRESETS.audit)[0]).toEqual({ "*": "ask" })
    expect(Object.keys(permissionPatches(PERMISSION_PRESETS.audit)[1])).not.toContain("*")
    expect(permissionPatches(PERMISSION_PRESETS.audit)[1].edit).toBe("deny")
  })

  test("skips empty patches", () => {
    expect(permissionPatches({ "*": "allow" })).toEqual([{ "*": "allow" }])
    expect(permissionPatches({ bash: "ask" })).toEqual([{ bash: "ask" }])
  })

  test("every preset denies or allows explicitly after its wildcard", () => {
    for (const preset of Object.values(PERMISSION_PRESETS)) {
      expect(Object.keys(preset)[0]).toBe("*")
    }
  })
})

describe("permissionValue", () => {
  test("resolves a bare action for every tool", () => {
    expect(permissionValue("deny", "bash")).toBe("deny")
  })

  test("resolves per-tool actions, defaults and pattern rules", () => {
    const config = { edit: "ask", bash: { "git *": "allow" } }
    expect(permissionValue(config, "edit")).toBe("ask")
    expect(permissionValue(config, "read")).toBe("default")
    expect(permissionValue(config, "bash")).toBe("custom")
    expect(permissionValue(undefined, "read")).toBe("default")
  })
})
