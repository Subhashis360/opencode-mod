// OpenCode Mod: name the app "OpenCode Mod" wherever a string means this app, in every language.
//
// Only these keys are renamed. Strings that mean OpenCode the service or the upstream project
// (free models "provided by OpenCode", OpenCode Zen, the OpenCode CLI installed in WSL, OpenCode's
// documentation) keep their wording. Brand names stay untranslated in every locale, so replacing
// "OpenCode" inside these keys works for all 61 languages without touching the locale files.
export const MOD_APP_NAME = "OpenCode Mod"

export const APP_NAME_KEYS = [
  // web app
  "app.name.desktop",
  "help.tabs.introduction",
  "toast.update.description",
  "settings.general.row.language.description",
  "settings.general.row.appearance.description",
  "settings.general.row.colorScheme.description",
  "settings.general.row.theme.description",
  "settings.updates.row.startup.description",
  "settings.updates.toast.latest.description",
  "provider.connect.apiKey.description",
  "provider.connect.oauth.code.visit.suffix",
  "provider.connect.oauth.auto.visit.suffix",
  "wsl.onboarding.wslNotInstalled.description",
  "wsl.onboarding.wslUnavailable.description",
  "wsl.onboarding.windowsRestartRequired",
  // native menus and window messages
  "desktop.menu.app",
  "desktop.menu.ariaLabel",
  "desktop.recovery.loadFailed",
  "desktop.recovery.terminated",
  "desktop.recovery.unresponsive",
  // desktop updater
  "desktop.updater.none.message",
  "desktop.updater.downloaded.prompt",
] as const

// "OpenCode Desktop" is the app's long name; plain "OpenCode" is the short one. Neither may already
// be followed by " Mod".
const NAME = /OpenCode(?: Desktop)?(?! Mod)/g

export function brandAppName(text: string) {
  return text.replace(NAME, MOD_APP_NAME)
}

export function brandDict<T extends Record<string, string>>(dict: T, enabled: boolean): T {
  if (!enabled) return dict
  const next: Record<string, string> = { ...dict }
  for (const key of APP_NAME_KEYS) {
    const value = next[key]
    if (typeof value === "string") next[key] = brandAppName(value)
  }
  return next as T
}
