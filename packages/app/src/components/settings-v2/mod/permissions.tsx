import type { Config } from "@opencode-ai/sdk/v2/client"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "../parts/list"
import { SettingsRowV2 } from "../parts/row"
import {
  isAction,
  isPlainObject,
  PERMISSION_PRESETS,
  PERMISSION_TOOLS,
  permissionPatches,
  permissionValue,
  type PermissionAction,
  type PermissionPreset,
} from "./entries"
import { ActionSelect, ModTabHeader, Unavailable, useModConfig } from "./shared"

const PRESETS: PermissionPreset[] = ["audit", "safe", "balanced", "auto"]

export function SettingsPermissionsV2() {
  const language = useLanguage()
  const mod = useModConfig()
  const current = () => mod.config().permission as unknown

  // A preset is active when the stored rules are exactly that preset.
  const active = (preset: PermissionPreset) => {
    const config = current()
    if (!isPlainObject(config)) return false
    const expected = PERMISSION_PRESETS[preset]
    const keys = Object.keys(config)
    return keys.length === Object.keys(expected).length && keys.every((key) => config[key] === expected[key])
  }

  // Replaces every stored rule, writing them so the wildcard ends up before the specific tools.
  const replaceRules = async (rules: Record<string, unknown>) => {
    if (current() !== undefined) await mod.remove(["permission"])
    for (const patch of permissionPatches(rules)) await mod.update({ permission: patch as Config["permission"] })
  }

  const applyPreset = (preset: PermissionPreset) =>
    mod.run(
      () => replaceRules(PERMISSION_PRESETS[preset]),
      language.t("mod.permissions.toast.preset", { name: language.t(`mod.permissions.preset.${preset}`) }),
    )

  const setTool = (tool: string, value: PermissionAction | "default") =>
    mod.run(async () => {
      const config = current()
      // A bare action applies to every tool, and a wildcard added after specific rules would
      // override them, so both cases rebuild the rules instead of patching one key.
      const rebuild =
        typeof config === "string" ||
        (tool === "*" &&
          value !== "default" &&
          isPlainObject(config) &&
          !("*" in config) &&
          Object.keys(config).length > 0)
      if (rebuild) {
        const rules: Record<string, unknown> =
          typeof config === "string" ? (isAction(config) ? { "*": config } : {}) : { ...(config as object) }
        if (value === "default") delete rules[tool]
        else rules[tool] = value
        await replaceRules(rules)
        return
      }
      if (value === "default") await mod.remove(["permission", tool])
      else await mod.update({ permission: { [tool]: value } })
    }, language.t("mod.permissions.toast.saved"))

  return (
    <>
      <ModTabHeader
        title={language.t("mod.permissions.title")}
        description={language.t("mod.permissions.description")}
      />
      <div class="settings-v2-tab-body">
        <Show when={mod.available()} fallback={<Unavailable />}>
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("mod.permissions.presets")}</h3>
            <p class="mod-tab-description">{language.t("mod.permissions.presets.hint")}</p>
            <div class="mod-presets">
              <For each={PRESETS}>
                {(preset) => (
                  <div class="mod-preset">
                    <div class="settings-v2-provider-main">
                      <span class="mod-preset-title">{language.t(`mod.permissions.preset.${preset}`)}</span>
                      <Show when={active(preset)}>
                        <Tag variant="accent">{language.t("mod.permissions.active")}</Tag>
                      </Show>
                    </div>
                    <p class="mod-preset-description">{language.t(`mod.permissions.preset.${preset}.description`)}</p>
                    <ButtonV2
                      size="normal"
                      variant={preset === "auto" ? "warning" : "neutral"}
                      disabled={active(preset)}
                      onClick={() => void applyPreset(preset)}
                    >
                      {language.t("mod.permissions.apply")}
                    </ButtonV2>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("mod.permissions.tools")}</h3>
            <SettingsListV2>
              <SettingsRowV2 title={language.t("mod.permissions.wildcard")} description="*">
                <ActionSelect value={permissionValue(current(), "*")} onChange={(value) => void setTool("*", value)} />
              </SettingsRowV2>
              <For each={PERMISSION_TOOLS}>
                {(tool) => (
                  <SettingsRowV2 title={language.t(`mod.permissions.tool.${tool}`)} description={tool}>
                    <ActionSelect
                      value={permissionValue(current(), tool)}
                      onChange={(value) => void setTool(tool, value)}
                    />
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
