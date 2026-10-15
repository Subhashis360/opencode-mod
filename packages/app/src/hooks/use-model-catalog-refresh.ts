import { useServerSDK } from "@/context/server-sdk"

// OpenCode Mod: re-download the model catalog from models.opencode.ai whenever a model picker
// opens, so the list is never older than the last open. The server publishes catalog.updated
// once the catalogs have reloaded, and server-sync refetches the provider lists on that event.
// The picker shows the current list straight away and updates in place if anything changed.
let pending: Promise<unknown> | undefined

export function useModelCatalogRefresh() {
  const serverSDK = useServerSDK()
  return () => {
    if (pending) return
    // A server without this route (an older one the app is attached to) keeps its usual hourly refresh.
    pending = serverSDK()
      .client.global.mod.modelsRefresh()
      .catch(() => undefined)
      .finally(() => {
        pending = undefined
      })
  }
}
