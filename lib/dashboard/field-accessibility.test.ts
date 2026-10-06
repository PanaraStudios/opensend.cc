import assert from "node:assert/strict"
import { test } from "node:test"
import { Window } from "happy-dom"
import { computeAccessibleName } from "dom-accessibility-api"

// A DOM test, not a browser/e2e run. Set up the DOM before Base UI imports.
const window = new Window({ url: "http://localhost:3000" })
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "MutationObserver",
  "ResizeObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const) {
  const value: unknown = key === "window" ? window : window[key]
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value:
      typeof value === "function" && /^[a-z]/.test(key)
        ? value.bind(window)
        : value,
  })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { createElement: h, act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { Field, FieldLabel } = await import("../../components/ui/field")
const { RadioGroup, RadioGroupItem } =
  await import("../../components/ui/radio-group")
const { Checkbox } = await import("../../components/ui/checkbox")
const { Switch } = await import("../../components/ui/switch")
const { Input } = await import("../../components/ui/input")
const { Textarea } = await import("../../components/ui/textarea")
const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } =
  await import("../../components/ui/select")
const { Combobox, ComboboxInput } = await import("../../components/ui/combobox")
const { RadioCards, OptionSelect } =
  await import("../../components/dashboard/primitives")

function field(label: string, ...controls: React.ReactNode[]) {
  return h(Field, null, h(FieldLabel, null, label), ...controls)
}

async function render(
  children: React.ReactNode,
  check: (container: HTMLDivElement) => void
) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(children))
    check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

function names(container: HTMLDivElement, selector: string) {
  return [...container.querySelectorAll(selector)].map((element) =>
    computeAccessibleName(element)
  )
}

test("provider radios retain option names and name only their group Engine", async () => {
  await render(
    field(
      "Engine",
      h(RadioCards, {
        "aria-label": "Engine",
        value: "gemini",
        onChange: () => {},
        options: [
          {
            value: "gemini",
            label: "Gemini Live",
            description: "Live conversation",
          },
          {
            value: "cascade",
            label: "Cascade",
            description: "Speech pipeline",
          },
        ],
      })
    ),
    (container) => {
      assert.deepEqual(names(container, '[role="radiogroup"]'), ["Engine"])
      assert.deepEqual(names(container, '[role="radio"]'), [
        "Gemini Live Live conversation",
        "Cascade Speech pipeline",
      ])
    }
  )
})

test("checkbox choices and explicitly named controls keep distinct e2e names", async () => {
  await render(
    h(
      "div",
      null,
      field(
        "Events",
        h("label", null, h(Checkbox), "Email sent"),
        h("label", null, h(Checkbox), "Email delivered")
      ),
      field("Support", h(Checkbox, { "aria-label": "Route Support" })),
      field(
        "Look up contact",
        h(Switch, { "aria-label": "Enable Look up contact" })
      ),
      field(
        "Microphone",
        h(
          Select,
          null,
          h(
            SelectTrigger,
            { "aria-label": "Softphone microphone" },
            h(SelectValue)
          )
        )
      ),
      field(
        "Select role",
        h(
          RadioGroup,
          { "aria-label": "Role" },
          h("label", null, h(RadioGroupItem, { value: "member" }), "Member")
        )
      )
    ),
    (container) => {
      assert.deepEqual(names(container, '[role="checkbox"]'), [
        "Email sent",
        "Email delivered",
        "Route Support",
      ])
      assert.deepEqual(names(container, '[role="switch"]'), [
        "Enable Look up contact",
      ])
      assert.deepEqual(names(container, '[role="combobox"]'), [
        "Softphone microphone",
      ])
      assert.deepEqual(names(container, '[role="radiogroup"]'), ["Role"])
      assert.deepEqual(names(container, '[role="radio"]'), ["Member"])
    }
  )
})

test("single controls and unnamed group containers still inherit visible field labels", async () => {
  await render(
    h(
      "div",
      null,
      field("Email", h(Input)),
      field("Prompt", h(Textarea)),
      field("Online", h(Switch)),
      field(
        "Language",
        h(Select, null, h(SelectTrigger, null, h(SelectValue)))
      ),
      field("Contact", h(Combobox, null, h(ComboboxInput))),
      field(
        "Voice",
        h(OptionSelect, {
          items: [{ value: "voice", label: "Voice option" }],
          search: { onChange: () => {} },
        })
      ),
      field(
        "Engine",
        h(
          RadioGroup,
          null,
          h(
            "label",
            null,
            h(RadioGroupItem, { value: "gemini" }),
            "Gemini Live"
          )
        )
      )
    ),
    (container) => {
      assert.deepEqual(names(container, '[data-slot="input"]'), ["Email"])
      assert.deepEqual(names(container, "textarea"), ["Prompt"])
      assert.deepEqual(names(container, '[role="switch"]'), ["Online"])
      assert.deepEqual(names(container, '[role="combobox"]'), [
        "Language",
        "Contact",
        "Voice",
      ])
      assert.deepEqual(names(container, '[role="radiogroup"]'), ["Engine"])
      assert.deepEqual(names(container, '[role="radio"]'), ["Gemini Live"])
    }
  )
})

test("explicit label references and native checkbox labels remain authoritative", async () => {
  await render(
    h(
      "div",
      null,
      h("span", { id: "specific-name" }, "Specific control"),
      field(
        "General field",
        h(Input, { "aria-label": "Other", "aria-labelledby": "specific-name" })
      ),
      h(
        Field,
        null,
        h(FieldLabel, { htmlFor: "sending" }, "Enable Sending"),
        h(Checkbox, { id: "sending" })
      )
    ),
    (container) => {
      assert.deepEqual(names(container, '[data-slot="input"]'), [
        "Specific control",
      ])
      assert.deepEqual(names(container, '[role="checkbox"]'), [
        "Enable Sending",
      ])
    }
  )
})

test("select options retain item names inside a named field", async () => {
  await render(
    field(
      "Gemini key",
      h(
        Select,
        { defaultOpen: true },
        h(SelectTrigger, null, h(SelectValue)),
        h(
          SelectContent,
          { alignItemWithTrigger: false },
          h(SelectItem, { value: "new" }, "Add provider key…"),
          h(SelectItem, { value: "existing" }, "Existing provider")
        )
      )
    ),
    () => {
      assert.deepEqual(
        names(document.body as HTMLDivElement, '[role="option"]'),
        ["Add provider key…", "Existing provider"]
      )
    }
  )
})
