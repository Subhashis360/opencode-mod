import type { ElectronAPI } from "../preload/types"

declare global {
  // Set by the app's Vite plugin for OpenCode Mod builds.
  interface ImportMetaEnv {
    readonly VITE_OPENCODE_MOD?: string
  }

  interface Window {
    api: ElectronAPI
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
