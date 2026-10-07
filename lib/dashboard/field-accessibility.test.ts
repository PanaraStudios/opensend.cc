import assert from "node:assert/strict"
import { test } from "node:test"
import { Window } from "happy-dom"
import { computeAccessibleName } from "dom-accessibility-api"

// A DOM test, not a browser/e2e run. Set up the DOM before Base UI imports.
const window = new Window({ url: "http://localhost:3000" })
for (const key of [
  "window",
  "self",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "NodeFilter",
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
const { Field, FieldLabel, FieldSet, FieldLegend } =
  await import("../../components/ui/field")
const { RadioGroup, RadioGroupItem } =
  await import("../../components/ui/radio-group")
const { Checkbox } = await import("../../components/ui/checkbox")
const { ToggleGroup, ToggleGroupItem } =
  await import("../../components/ui/toggle-group")
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
  check: (container: HTMLDivElement) => void | Promise<void>
) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(children))
    await check(container)
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

// Label locators consider aria-labelledby on generic elements too, even when
// their role does not allow an accessible name. Check the actual associations.
function elementsForLabel(container: HTMLDivElement, label: HTMLLabelElement) {
  return [...container.querySelectorAll("*")].filter(
    (element) =>
      element === label.control ||
      element.getAttribute("aria-labelledby")?.split(/\s+/).includes(label.id)
  )
}

test("a single-input Field has exactly one label target, with or without htmlFor", async () => {
  for (const htmlFor of ["name", undefined]) {
    await render(
      h(
        Field,
        null,
        h(FieldLabel, { htmlFor }, "Name"),
        h(Input, { id: "name" })
      ),
      (container) => {
        const label = container.querySelector("label")!
        const input = container.querySelector("input")!
        const targets = elementsForLabel(container, label)
        assert.equal(targets.length, 1)
        assert.ok(targets[0] === input)
        assert.equal(computeAccessibleName(input), "Name")
        const wrapper = container.querySelector('[data-slot="field"]')!
        assert.equal(wrapper.hasAttribute("role"), false)
        assert.equal(wrapper.hasAttribute("aria-labelledby"), false)
        assert.equal(wrapper.hasAttribute("aria-label"), false)
      }
    )
  }
})

test("a RadioGroup alone receives the field label while its radios keep option names", async () => {
  await render(
    field(
      "Engine",
      h(
        RadioGroup,
        { defaultValue: "gemini" },
        h("label", null, h(RadioGroupItem, { value: "gemini" }), "Gemini Live"),
        h("label", null, h(RadioGroupItem, { value: "cascade" }), "Cascade")
      )
    ),
    (container) => {
      const label = container.querySelector(
        '[data-slot="field-label"]'
      ) as HTMLLabelElement
      const targets = elementsForLabel(container, label)
      assert.equal(targets.length, 1)
      assert.ok(targets[0] === container.querySelector('[role="radiogroup"]'))
      assert.deepEqual(names(container, '[role="radiogroup"]'), ["Engine"])
      assert.deepEqual(names(container, '[role="radio"]'), [
        "Gemini Live",
        "Cascade",
      ])
    }
  )
})

test("explicit checkbox groups and ToggleGroup receive only the group name", async () => {
  await render(
    h(
      "div",
      null,
      h(
        Field,
        { role: "group" },
        h(FieldLabel, null, "Events"),
        h("label", null, h(Checkbox), "Email sent"),
        h("label", null, h(Checkbox), "Email delivered")
      ),
      field(
        "Display",
        h(
          ToggleGroup,
          null,
          h(ToggleGroupItem, { value: "list" }, "List"),
          h(ToggleGroupItem, { value: "grid" }, "Grid")
        )
      ),
      h(
        FieldSet,
        null,
        h(FieldLegend, null, "Channels"),
        h("label", null, h(Checkbox), "Email")
      )
    ),
    (container) => {
      assert.deepEqual(names(container, '[role="group"]'), [
        "Events",
        "Display",
      ])
      assert.deepEqual(names(container, '[role="checkbox"]'), [
        "Email sent",
        "Email delivered",
        "Email",
      ])
      assert.deepEqual(names(container, '[data-slot="toggle-group-item"]'), [
        "List",
        "Grid",
      ])
      assert.deepEqual(names(container, "fieldset"), ["Channels"])
      for (const label of container.querySelectorAll<HTMLLabelElement>(
        '[data-slot="field-label"]'
      )) {
        assert.equal(elementsForLabel(container, label).length, 1)
      }
    }
  )
})

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

test("shared icon controls retain names through trigger render composition", async () => {
  const { MoreMenu, CopyButton } =
    await import("../../components/dashboard/primitives")
  await render(
    h(
      "div",
      null,
      h(MoreMenu, null, "Edit"),
      h(CopyButton, { value: "Customer reference" })
    ),
    (container) => {
      assert.deepEqual(names(container, "button"), ["More options", "Copy"])
    }
  )
})

test("searchable triggers keep their visible control names", async () => {
  const { SearchableSelect } =
    await import("../../components/dashboard/primitives")
  const { Button } = await import("../../components/ui/button")
  await render(
    h(SearchableSelect, {
      value: "",
      items: [],
      search: { onChange: () => {}, placeholder: "Search segments…" },
      trigger: () => h(Button, null, "Add to segment"),
    }),
    async (container) => {
      assert.deepEqual(names(container, "button"), ["Add to segment"])
      await act(async () =>
        container.querySelector<HTMLButtonElement>("button")!.click()
      )
      assert.equal(
        computeAccessibleName(document.querySelector('[role="dialog"]')!),
        "Search segments…"
      )
    }
  )
})

test("auth framing supplies one main containing the form and branding", async () => {
  const { AuthPageFrame } = await import("../../components/auth/page-frame")
  await render(
    h(AuthPageFrame, null, h("h1", null, "Connect application")),
    (container) => {
      assert.equal(container.querySelectorAll("main").length, 1)
      assert.ok(container.querySelector("main h1"))
      assert.ok(container.querySelector("main a[href='/']"))
    }
  )
})

test("the shared workflow canvas is a named keyboard scroll target", async () => {
  const { WorkflowCanvas } =
    await import("../../components/dashboard/flows/workflow")
  await render(
    h(WorkflowCanvas, {
      trigger: "Trigger",
      steps: [],
      branches: () => [],
      renderStep: () => null,
    }),
    (container) => {
      const canvas = container.querySelector<HTMLElement>(
        '[data-testid="workflow"]'
      )!
      assert.equal(canvas.tabIndex, 0)
      assert.equal(computeAccessibleName(canvas), "Workflow canvas")
    }
  )
})

test("popover dialogs inherit a trigger name, while a title or explicit name takes precedence", async () => {
  const { Popover, PopoverTrigger, PopoverContent, PopoverTitle } =
    await import("../../components/ui/popover")
  for (const [title, explicit, expected] of [
    [undefined, undefined, "Review"],
    ["Ready to send?", undefined, "Ready to send?"],
    [undefined, "Delivery review", "Delivery review"],
  ]) {
    await render(
      h(
        Popover,
        { defaultOpen: true },
        h(PopoverTrigger, null, "Review"),
        h(
          PopoverContent,
          { "aria-label": explicit },
          title ? h(PopoverTitle, null, title) : "Audience checks"
        )
      ),
      () => {
        assert.equal(
          computeAccessibleName(
            document.querySelector('[data-slot="popover-content"]')!
          ),
          expected
        )
      }
    )
  }
})

test("shared scroll wells and table wrappers are named keyboard targets and empty headers name actions", async () => {
  const { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } =
    await import("../../components/ui/table")
  const { JsonSection } = await import("../../components/dashboard/primitives")
  await render(
    h(
      "div",
      null,
      h(
        Table,
        { "aria-label": "Request headers" },
        h(
          TableHeader,
          null,
          h(TableRow, null, h(TableHead, null, "Header"), h(TableHead))
        ),
        h(
          TableBody,
          null,
          h(
            TableRow,
            null,
            h(TableCell, null, "Content type"),
            h(TableCell, null, "View")
          )
        )
      ),
      h(JsonSection, {
        title: "Resolved inputs",
        value: { customer: "Example" },
      })
    ),
    (container) => {
      assert.deepEqual(names(container, "th"), ["Header", "Actions"])
      assert.equal(
        container.querySelector("th:last-child span")?.className,
        "sr-only"
      )
      assert.deepEqual(names(container, '[role="group"]'), [
        "Request headers scroll area",
        "Resolved inputs",
      ])
      for (const region of container.querySelectorAll<HTMLElement>(
        '[role="group"]'
      ))
        assert.equal(region.tabIndex, 0)
    }
  )
})

test("portaled dropdown menu content is contained by a named landmark", async () => {
  const {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  } = await import("../../components/ui/dropdown-menu")
  await render(
    h(
      DropdownMenu,
      { defaultOpen: true },
      h(DropdownMenuTrigger, null, "Add channel"),
      h(DropdownMenuContent, null, h(DropdownMenuItem, null, "Email domain"))
    ),
    () => {
      const menu = document.querySelector('[role="menu"]')!
      assert.equal(
        computeAccessibleName(menu.closest('[role="region"]')!),
        "Menu"
      )
      assert.equal(
        computeAccessibleName(menu.querySelector('[role="menuitem"]')!),
        "Email domain"
      )
    }
  )
})
