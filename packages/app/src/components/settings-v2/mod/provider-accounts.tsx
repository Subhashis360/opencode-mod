// OpenCode Mod: several accounts per provider, under each connected provider in Settings → Providers.
// The server keeps every account and switches to the next one by itself when the active account
// reaches a usage or rate limit; here the user adds, picks and removes accounts.
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { createResource, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

export type ProviderAccount = {
  id: string
  label: string
  kind: "api" | "oauth" | "wellknown"
  added: number
  active: boolean
  limitedUntil?: number
}

export function useProviderAccounts() {
  const serverSdk = useServerSDK()
  const language = useLanguage()
  const [accounts, { refetch }] = createResource(
    async (): Promise<Record<string, ProviderAccount[]>> => {
      const result = await serverSdk()
        .client.global.mod.accounts()
        .catch(() => undefined)
      return (result?.data as Record<string, ProviderAccount[]> | undefined) ?? {}
    },
    { initialValue: {} },
  )

  const fail = (err: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  // Credentials are loaded once per project; reload so the next request uses the chosen account,
  // as disconnecting a provider does.
  const reload = () => serverSdk().client.global.dispose()

  return {
    list: (providerID: string) => accounts()[providerID] ?? [],
    refetch: () => void refetch(),
    /** Prepares the next login for the provider to add an account. */
    beginAdd: async (providerID: string) => {
      const result = await serverSdk()
        .client.global.mod.accountsAdd({ providerID }, { throwOnError: true })
        .then(() => true)
        .catch((err: unknown) => (fail(err), false))
      return result
    },
    use: async (providerID: string, account: ProviderAccount) => {
      await serverSdk()
        .client.global.mod.accountsSelect({ providerID, accountID: account.id }, { throwOnError: true })
        .then(reload)
        .then(() =>
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("mod.accounts.toast.switched", { account: account.label }),
          }),
        )
        .catch(fail)
      void refetch()
    },
    remove: async (providerID: string, account: ProviderAccount) => {
      await serverSdk()
        .client.global.mod.accountsRemove({ providerID, accountID: account.id }, { throwOnError: true })
        .then(reload)
        .then(() =>
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("mod.accounts.toast.removed", { account: account.label }),
          }),
        )
        .catch(fail)
      void refetch()
    },
  }
}

export const ProviderAccountList: Component<{
  providerID: string
  accounts: ProviderAccount[]
  onUse: (account: ProviderAccount) => void
  onRemove: (account: ProviderAccount) => void
}> = (props) => {
  const language = useLanguage()
  const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

  return (
    <div class="settings-v2-provider-accounts" data-component="provider-accounts">
      <p class="settings-v2-provider-accounts-hint">
        {language.t("mod.accounts.hint", { count: props.accounts.length })}
      </p>
      <For each={props.accounts}>
        {(account) => (
          <div class="settings-v2-provider-account" data-active={account.active ? "" : undefined}>
            <div class="settings-v2-provider-main">
              <span class="settings-v2-provider-account-name">{account.label}</span>
              <Show when={account.active}>
                <Tag>{language.t("mod.accounts.active")}</Tag>
              </Show>
              <Show when={account.limitedUntil}>
                {(until) => <Tag>{language.t("mod.accounts.limited", { time: time(until()) })}</Tag>}
              </Show>
            </div>
            <div class="settings-v2-provider-actions">
              <Show when={!account.active}>
                <ButtonV2 size="normal" variant="ghost-muted" onClick={() => props.onUse(account)}>
                  {language.t("mod.accounts.use")}
                </ButtonV2>
              </Show>
              <ButtonV2 size="normal" variant="ghost-muted" onClick={() => props.onRemove(account)}>
                {language.t("mod.accounts.remove")}
              </ButtonV2>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
