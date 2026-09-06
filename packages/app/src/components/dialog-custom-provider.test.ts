import { describe, expect, test } from "bun:test"
import { formStateFromConfig, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", err: {} },
          { row: "m1", id: "model-a", name: "Model A 2", err: {} },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })
})

describe("formStateFromConfig", () => {
  test("restores an existing provider into editable rows", () => {
    const form = formStateFromConfig("custom-provider", {
      name: "Custom Provider",
      env: ["CUSTOM_PROVIDER_KEY"],
      options: {
        baseURL: "https://api.example.com",
        headers: { "X-Test": "enabled" },
      },
      models: {
        "model-a": { name: "Model A" },
        "model-b": { name: "Model B" },
      },
    })

    expect(form.providerID).toBe("custom-provider")
    expect(form.name).toBe("Custom Provider")
    expect(form.baseURL).toBe("https://api.example.com")
    expect(form.apiKey).toBe("{env:CUSTOM_PROVIDER_KEY}")
    expect(form.models.map((m) => [m.id, m.name])).toEqual([
      ["model-a", "Model A"],
      ["model-b", "Model B"],
    ])
    expect(form.headers.map((h) => [h.key, h.value])).toEqual([["X-Test", "enabled"]])
  })

  test("leaves a stored key blank and keeps one empty row to type into", () => {
    const form = formStateFromConfig("custom-provider", {
      name: "Custom Provider",
      options: { baseURL: "https://api.example.com" },
    })

    expect(form.apiKey).toBe("")
    expect(form.models).toHaveLength(1)
    expect(form.headers).toHaveLength(1)
    expect(form.models[0].id).toBe("")
  })

  test("round-trips an edited provider without flagging its own ID as taken", () => {
    const form = formStateFromConfig("custom-provider", {
      name: "Custom Provider",
      options: { baseURL: "https://api.example.com" },
      models: { "model-a": { name: "Model A" } },
    })

    const result = validateCustomProvider({
      form: { ...form, baseURL: "https://api.example.com/v2" },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.err.providerID).toBeUndefined()
    expect(result.result?.config.options.baseURL).toBe("https://api.example.com/v2")
  })

  test("still rejects an ID that belongs to a different provider", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "other-provider",
        name: "Custom Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [{ row: "m0", id: "model-a", name: "Model A", err: {} }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(["other-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.err.providerID).toBe("provider.custom.error.providerID.exists")
  })
})
