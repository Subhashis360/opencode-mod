import { describe, expect, test } from "bun:test"
import { brandAppName, brandDict } from "./mod-brand"

describe("mod app name", () => {
  test("renames the app's short and long name once", () => {
    expect(brandAppName("Customise how OpenCode looks on your device")).toBe(
      "Customise how OpenCode Mod looks on your device",
    )
    expect(brandAppName("OpenCode Desktop is now built around tabs.")).toBe("OpenCode Mod is now built around tabs.")
    expect(brandAppName("OpenCode Mod is ready")).toBe("OpenCode Mod is ready")
  })

  test("renames only app-name keys, in any language", () => {
    const dict = {
      "desktop.recovery.unresponsive": "OpenCode reagiert nicht",
      "dialog.model.unpaid.freeModels.title": "Free models provided by OpenCode",
    }
    expect(brandDict(dict, true)).toEqual({
      "desktop.recovery.unresponsive": "OpenCode Mod reagiert nicht",
      "dialog.model.unpaid.freeModels.title": "Free models provided by OpenCode",
    })
  })

  test("leaves official builds alone", () => {
    const dict = { "desktop.menu.app": "OpenCode" }
    expect(brandDict(dict, false)).toBe(dict)
  })
})
