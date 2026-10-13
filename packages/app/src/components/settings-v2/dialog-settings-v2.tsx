import { Component, createMemo, createSignal, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/v2/dialog-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneralV2 } from "./general"
import { SettingsKeybinds } from "../settings-keybinds"
import { SettingsProvidersV2 } from "./providers"
import { SettingsModelsV2 } from "./models"
import "./settings-v2.css"
import { SettingsServersV2 } from "./servers"
import { SettingsAgentsV2 } from "./mod/agents"
import { SettingsPermissionsV2 } from "./mod/permissions"
import { SettingsMcpV2 } from "./mod/mcp"
import { SettingsCommandsV2 } from "./mod/commands"
import { SettingsAccountV2 } from "./mod/account"
import { SettingsExperimentalV2 } from "./mod/experimental"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"

export const DialogSettings: Component<{
  sessionID?: string
  defaultValue?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")
  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return undefined
  })

  const showProviders = () => {
    void dialog.show(() => <DialogSettings sessionID={props.sessionID} defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" variant="settings" class="settings-v2-dialog">
      <TabsV2
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="settings-v2"
      >
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </TabsV2.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.server")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </TabsV2.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("mod.section")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="account">
                      <Icon name="glasses" />
                      {language.t("mod.account.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="agents">
                      <Icon name="subagent" />
                      {language.t("mod.agents.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="permissions">
                      <Icon name="shield" />
                      {language.t("mod.permissions.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="mcp">
                      <Icon name="mcp" />
                      {language.t("mod.mcp.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="commands">
                      <Icon name="console" />
                      {language.t("mod.commands.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="experimental">
                      <Icon name="brain" />
                      {language.t("mod.experimental.title")}
                    </TabsV2.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="settings-v2-nav-footer">
              <span>{language.t("app.name.desktop")}</span>
              <span>v{platform.version}</span>
            </div>
          </div>
        </TabsV2.List>
        <TabsV2.Content value="general" class="settings-v2-panel">
          <SettingsGeneralV2 sessionID={props.sessionID} />
        </TabsV2.Content>
        <TabsV2.Content value="shortcuts" class="settings-v2-panel">
          <SettingsKeybinds v2 />
        </TabsV2.Content>
        <TabsV2.Content value="servers" class="settings-v2-panel">
          <SettingsServersV2 />
        </TabsV2.Content>
        <TabsV2.Content value="providers" class="settings-v2-panel">
          <SettingsProvidersV2 directory={directory} onBack={showProviders} />
        </TabsV2.Content>
        <TabsV2.Content value="models" class="settings-v2-panel">
          <SettingsModelsV2 />
        </TabsV2.Content>
        <TabsV2.Content value="account" class="settings-v2-panel">
          <SettingsAccountV2 onOpenProviders={() => void startTransition(() => setTab("providers"))} />
        </TabsV2.Content>
        <TabsV2.Content value="agents" class="settings-v2-panel">
          <SettingsAgentsV2 />
        </TabsV2.Content>
        <TabsV2.Content value="permissions" class="settings-v2-panel">
          <SettingsPermissionsV2 />
        </TabsV2.Content>
        <TabsV2.Content value="mcp" class="settings-v2-panel">
          <SettingsMcpV2 />
        </TabsV2.Content>
        <TabsV2.Content value="commands" class="settings-v2-panel">
          <SettingsCommandsV2 />
        </TabsV2.Content>
        <TabsV2.Content value="experimental" class="settings-v2-panel">
          <SettingsExperimentalV2 />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}
