import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsListV2 } from "../parts/list"
import { DeleteButton, ModTabHeader, Unavailable, useModConfig } from "./shared"

type Org = { id: string; name: string }
type Account = { id: string; email: string; url: string; active: boolean; activeOrgID: string | null; orgs: Org[] }
type SignIn =
  | { state: "starting" }
  | { state: "waiting"; id: string; userCode: string; verificationUrl: string }
  | { state: "failed"; message: string }

// Same default Console as `opencode account login`. Sent explicitly because the generated client
// omits the request body when every field is empty, which the route rejects.
const CONSOLE_URL = "https://opencode.ai/console"

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function SettingsAccountV2(props: { onOpenProviders?: () => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const mod = useModConfig()
  const providers = useProviders(() => undefined)
  const client = () => serverSDK().client.global.account

  const [accounts, { refetch }] = createResource(
    () => mod.available() || undefined,
    async (): Promise<Account[]> => (await client().list()).data?.accounts ?? [],
  )
  // A failed lookup (for example a server without these routes) shows a message instead of breaking.
  const accountList = () => (accounts.error ? [] : (accounts() ?? []))

  // Chats can run without an OpenCode account, so show what they actually use: the free models and
  // every provider connected with its own key, sign-in, environment variable or config.
  const connectedProviders = createMemo(() => providers.connected().filter((provider) => provider.id !== "opencode"))
  const sourceLabel = (provider: { source?: unknown }) => {
    if (provider.source === "env") return language.t("settings.providers.tag.environment")
    if (provider.source === "api") return language.t("provider.connect.method.apiKey")
    if (provider.source === "config") return language.t("settings.providers.tag.config")
    if (provider.source === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const [signIn, setSignIn] = createSignal<SignIn>()
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
  })

  const current = () => {
    const value = signIn()
    return value?.state === "waiting" ? value : undefined
  }

  const failure = () => {
    const value = signIn()
    return value?.state === "failed" ? value.message : undefined
  }

  const fail = (message: string) => setSignIn({ state: "failed", message })

  // Device sign-in: the server keeps the device code and this page polls at the interval the
  // Console asks for, backing off when told to slow down.
  const poll = async (id: string, seconds: number) => {
    if (disposed || current()?.id !== id) return
    const result = await client()
      .loginPoll({ id })
      .then((response) => response.data)
      .catch((err: unknown) => ({ status: "error" as const, error: errorText(err) }))
    if (disposed || current()?.id !== id) return
    if (result?.status === "pending") return schedule(id, seconds)
    if (result?.status === "slow_down") return schedule(id, seconds + 5)
    if (result?.status === "success") {
      setSignIn(undefined)
      void mod.run(async () => refetch(), language.t("mod.account.toast.signedIn", { email: result.email ?? "" }))
      return
    }
    if (result?.status === "expired") return fail(language.t("mod.account.error.expired"))
    if (result?.status === "denied") return fail(language.t("mod.account.error.denied"))
    fail(language.t("mod.account.error.failed", { message: result?.error ?? "" }))
  }

  const schedule = (id: string, seconds: number) => {
    timer = setTimeout(() => void poll(id, seconds), Math.max(1, seconds) * 1000)
  }

  const startSignIn = async () => {
    clearTimeout(timer)
    setCopied(false)
    setSignIn({ state: "starting" })
    const started = await client()
      .login({ url: CONSOLE_URL })
      .then((response) => response.data)
      .catch((err: unknown) => ({ success: false as const, error: errorText(err) }))
    if (disposed) return
    if (!started?.success) return fail(language.t("mod.account.error.failed", { message: started?.error ?? "" }))
    setSignIn({
      state: "waiting",
      id: started.id,
      userCode: started.userCode,
      verificationUrl: started.verificationUrl,
    })
    platform.openExternal(started.verificationUrl)
    schedule(started.id, started.intervalSeconds)
  }

  const cancelSignIn = () => {
    clearTimeout(timer)
    setSignIn(undefined)
  }

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code).catch(() => undefined)
    setCopied(true)
  }

  const switchTo = (account: Account, orgID?: string) =>
    mod.run(
      async () => {
        await client().switch({ accountID: account.id, ...(orgID ? { orgID } : {}) })
        await refetch()
      },
      language.t("mod.account.toast.switched", { email: account.email }),
    )

  const signOut = (account: Account) =>
    mod.run(
      async () => {
        await client().logout({ accountID: account.id })
        await refetch()
      },
      language.t("mod.account.toast.signedOut", { email: account.email }),
    )

  return (
    <>
      <ModTabHeader
        title={language.t("mod.account.title")}
        description={language.t("mod.account.description")}
        actions={
          <Show when={mod.available() && !signIn()}>
            <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => void startSignIn()}>
              {language.t("mod.account.add")}
            </ButtonV2>
          </Show>
        }
      />
      <div class="settings-v2-tab-body">
        <Show when={mod.available()} fallback={<Unavailable />}>
          <Show when={signIn()}>
            {(state) => (
              <div class="mod-editor">
                <h3 class="mod-editor-title">{language.t("mod.account.signIn.title")}</h3>
                <Switch>
                  <Match when={state().state === "starting"}>
                    <p class="mod-tab-description">{language.t("mod.account.signIn.starting")}</p>
                  </Match>
                  <Match when={current()}>
                    {(waiting) => (
                      <>
                        <p class="mod-tab-description">{language.t("mod.account.signIn.step")}</p>
                        <div class="mod-signin-code">{waiting().userCode}</div>
                        <p class="mod-field-hint">{language.t("mod.account.signIn.waiting")}</p>
                      </>
                    )}
                  </Match>
                  <Match when={failure()}>{(message) => <p class="mod-field-error">{message()}</p>}</Match>
                </Switch>
                <div class="mod-editor-actions">
                  <ButtonV2 size="normal" variant="ghost" onClick={cancelSignIn}>
                    {language.t("common.cancel")}
                  </ButtonV2>
                  <Show when={current()}>
                    {(waiting) => (
                      <>
                        <ButtonV2 size="normal" variant="ghost" onClick={() => void copyCode(waiting().userCode)}>
                          {copied() ? language.t("mod.account.signIn.copied") : language.t("mod.account.signIn.copy")}
                        </ButtonV2>
                        <ButtonV2
                          size="normal"
                          variant="contrast"
                          onClick={() => platform.openExternal(waiting().verificationUrl)}
                        >
                          {language.t("mod.account.signIn.open")}
                        </ButtonV2>
                      </>
                    )}
                  </Show>
                  <Show when={state().state === "failed"}>
                    <ButtonV2 size="normal" variant="neutral" onClick={() => void startSignIn()}>
                      {language.t("mod.account.add")}
                    </ButtonV2>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <div class="settings-v2-section">
            <SettingsListV2>
              <Show
                when={accountList().length > 0}
                fallback={
                  <div class="settings-v2-provider-empty">
                    {accounts.error ? language.t("mod.account.error.unavailable") : language.t("mod.account.empty")}
                  </div>
                }
              >
                <For each={accountList()}>
                  {(account) => (
                    <div class="settings-v2-provider-row">
                      <div class="settings-v2-provider-lead">
                        <div class="settings-v2-provider-copy">
                          <div class="settings-v2-provider-main">
                            <span class="settings-v2-provider-name">{account.email}</span>
                            <Show when={account.active}>
                              <Tag variant="accent">{language.t("mod.account.active")}</Tag>
                            </Show>
                          </div>
                          <span class="mod-entry-meta">{account.url}</span>
                        </div>
                      </div>
                      <div class="settings-v2-provider-actions">
                        <Show when={account.orgs.length > 1}>
                          <SelectV2
                            appearance="inline"
                            options={account.orgs}
                            current={account.orgs.find((org) => org.id === account.activeOrgID)}
                            placeholder={language.t("mod.account.org")}
                            placement="bottom-end"
                            gutter={6}
                            value={(org) => org.id}
                            label={(org) => org.name}
                            onSelect={(org) => org && org.id !== account.activeOrgID && void switchTo(account, org.id)}
                          />
                        </Show>
                        <Show when={account.orgs.length === 1}>
                          <span class="mod-entry-meta">{account.orgs[0]?.name}</span>
                        </Show>
                        <Show when={!account.active}>
                          <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void switchTo(account)}>
                            {language.t("mod.account.switch")}
                          </ButtonV2>
                        </Show>
                        <DeleteButton
                          label={language.t("mod.account.signOut")}
                          confirmLabel={language.t("mod.account.confirmSignOut")}
                          onConfirm={() => void signOut(account)}
                        />
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("mod.account.access.title")}</h3>
            <p class="mod-tab-description">{language.t("mod.account.access.description")}</p>
            <SettingsListV2>
              <div class="settings-v2-provider-row">
                <div class="settings-v2-provider-lead">
                  <ProviderIcon id="opencode" width={16} height={16} class="settings-v2-provider-icon shrink-0" />
                  <div class="settings-v2-provider-copy">
                    <div class="settings-v2-provider-main">
                      <span class="settings-v2-provider-name">{language.t("mod.account.access.free")}</span>
                      <Tag>{language.t("mod.account.access.free.tag")}</Tag>
                    </div>
                    <p class="settings-v2-provider-description">{language.t("mod.account.access.free.description")}</p>
                  </div>
                </div>
              </div>
              <For each={connectedProviders()}>
                {(provider) => (
                  <div class="settings-v2-provider-row">
                    <div class="settings-v2-provider-lead">
                      <ProviderIcon
                        id={provider.id}
                        width={16}
                        height={16}
                        class="settings-v2-provider-icon shrink-0"
                      />
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name">{provider.name}</span>
                        <Tag>{sourceLabel(provider)}</Tag>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </SettingsListV2>
            <Show when={props.onOpenProviders}>
              <ButtonV2 size="normal" variant="neutral" onClick={() => props.onOpenProviders?.()}>
                {language.t("mod.account.access.manage")}
              </ButtonV2>
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}
