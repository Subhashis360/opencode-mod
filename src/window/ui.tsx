import { usePlugin } from "@opencode/plugin/gui"
import { children as resolve, createContext, For, type JSX, Show, splitProps, useContext } from "solid-js"

// The controls the settings pages use. A plugin gets the app's Button and Switch through `ctx.ui`; the text fields
// carry the app's own data attributes, so its stylesheet draws them like its own fields; the rest are built from
// those.

/** The plugin's window context, under the name the pages were written with. */
export const useExtension = usePlugin

type ButtonVariant = "neutral" | "ghost" | "danger" | "submit" | "contrast"

export function Button(props: {
  variant?: ButtonVariant
  size?: "small" | "normal" | "large"
  disabled?: boolean
  class?: string
  onClick?: (event: MouseEvent) => void
  children: JSX.Element
}) {
  const ctx = usePlugin()
  return (
    <ctx.ui.Button
      variant={props.variant === "submit" ? "contrast" : props.variant}
      size={props.size}
      disabled={props.disabled}
      class={props.class}
      onClick={props.onClick}
    >
      {props.children}
    </ctx.ui.Button>
  )
}

export function Switch(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  hideLabel?: boolean
  children?: JSX.Element
}) {
  const ctx = usePlugin()
  const label = resolve(() => props.children)
  return (
    <ctx.ui.Switch
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
      hideLabel={props.hideLabel}
      label={String(label() ?? "")}
    />
  )
}

export function TextInput(
  props: JSX.InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean; invalid?: boolean },
) {
  const [local, input] = splitProps(props, ["class", "numeric", "invalid", "disabled", "type"])
  return (
    <div
      data-component="text-input-v2"
      data-appearance="base"
      data-disabled={local.disabled ? "" : undefined}
      data-invalid={local.invalid ? "" : undefined}
      data-numeric={local.numeric ? "" : undefined}
      class={local.class}
    >
      <div data-slot="text-input-v2-value">
        <input
          {...input}
          type={local.type ?? "text"}
          inputMode={local.numeric ? "numeric" : input.inputMode}
          disabled={local.disabled}
          aria-invalid={local.invalid ? true : undefined}
          data-slot="text-input-v2-input"
        />
      </div>
    </div>
  )
}

export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const [local, textarea] = splitProps(props, ["class", "invalid", "disabled", "rows"])
  return (
    <div
      data-component="textarea-v2"
      data-disabled={local.disabled ? "" : undefined}
      data-invalid={local.invalid ? "" : undefined}
      class={local.class}
    >
      <textarea
        {...textarea}
        rows={local.rows ?? 3}
        disabled={local.disabled}
        aria-invalid={local.invalid ? true : undefined}
        data-slot="textarea-v2-textarea"
      />
    </div>
  )
}

/**
 * A dropdown of `options`: a native select drawn like the app's fields. Without `current` it is a picker, such as
 * Templates: it shows the placeholder and goes back to it after each pick.
 */
export function Select<T>(props: {
  options: readonly T[]
  current?: T
  label: (option: T) => string
  value?: (option: T) => string
  placeholder?: string
  disabled?: boolean
  onSelect: (option: T | undefined) => void
}) {
  const key = (option: T) => (props.value ? props.value(option) : String(option))
  const index = () => {
    const current = props.current
    if (current === undefined) return -1
    return props.options.findIndex((option) => key(option) === key(current))
  }
  return (
    <div data-component="text-input-v2" data-appearance="base" data-disabled={props.disabled ? "" : undefined} class="ocm-select">
      <select
        disabled={props.disabled}
        aria-label={props.placeholder}
        onChange={(event) => {
          const picked = props.options[Number(event.currentTarget.value)]
          if (props.current === undefined) event.currentTarget.value = "-1"
          props.onSelect(picked)
        }}
      >
        <Show when={index() === -1}>
          <option value="-1" disabled selected>
            {props.placeholder ?? ""}
          </option>
        </Show>
        <For each={props.options}>
          {(option, i) => (
            <option value={String(i())} selected={i() === index()}>
              {props.label(option)}
            </option>
          )}
        </For>
      </select>
    </div>
  )
}

const Choice = createContext<{ value: () => string; set: (value: string) => void }>()

function Option(props: { value: string; children: JSX.Element }) {
  const choice = useContext(Choice)!
  return (
    <Button
      size="small"
      variant={choice.value() === props.value ? "neutral" : "ghost"}
      onClick={() => choice.set(props.value)}
    >
      {props.children}
    </Button>
  )
}

/** One choice from a few, as a row of buttons. */
export function SegmentedControl(props: { value: string; onChange: (value: string) => void; children: JSX.Element }) {
  return (
    <Choice.Provider value={{ value: () => props.value, set: (value) => props.onChange(value) }}>
      <div role="radiogroup" class="flex flex-wrap gap-1">
        {props.children}
      </div>
    </Choice.Provider>
  )
}

export const SegmentedControlItem = Option

function TabsRoot(props: { value: string; onChange: (value: string) => void; variant?: string; children: JSX.Element }) {
  return (
    <Choice.Provider value={{ value: () => props.value, set: (value) => props.onChange(value) }}>
      {props.children}
    </Choice.Provider>
  )
}

/** The page's tabs, as a wrapping row of buttons. */
export const Tabs = Object.assign(TabsRoot, {
  List: (props: { children: JSX.Element }) => (
    <div role="tablist" class="flex flex-wrap gap-1 border-b border-v2-border-border-weak pb-2">
      {props.children}
    </div>
  ),
  Trigger: Option,
})
