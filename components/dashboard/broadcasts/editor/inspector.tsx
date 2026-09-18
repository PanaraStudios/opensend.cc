"use client"

import * as React from "react"
import {
  getPanelTitle,
  setGlobalCssInjected,
  SUPPORTED_CSS_PROPERTIES,
  useEmailTheming,
  type KnownCssProperties,
  type PanelGroup,
} from "@react-email/editor/plugins"
import {
  getNodeMeta,
  Inspector as EngineInspector,
  type InspectorDocumentProps,
  type InspectorNodeContext,
  type InspectorTextContext,
} from "@react-email/editor/ui"
import { useCurrentEditor } from "@tiptap/react"
import {
  BoldIcon,
  BracesIcon,
  FileIcon,
  ItalicIcon,
  PaletteIcon,
  PanelRightCloseIcon,
  PlusIcon,
  SquareIcon,
  StrikethroughIcon,
  TypeIcon,
  UnderlineIcon,
  XIcon,
} from "lucide-react"

import { BoxField, type BoxValue } from "@/components/ui/box-field"
import { Button } from "@/components/ui/button"
import { ColorField } from "@/components/ui/color-field"
import { Input } from "@/components/ui/input"
import { NumberField } from "@/components/ui/number-field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { OptionSelect } from "@/components/dashboard/primitives"
import { CodeEditor } from "@/components/dashboard/broadcasts/editor/code-editor"
import {
  AlignField,
  InspectorRow,
  InspectorSection,
  type EmailAlign,
} from "@/components/dashboard/broadcasts/editor/controls"

/* The engine decides what is selected and hands each panel its values and
   setters; every control drawn here is one of ours. */

const CSS_SNIPPETS = [
  {
    id: "dark",
    label: "@media (prefers-color-scheme: dark)",
    code: "@media (prefers-color-scheme: dark) {\n  \n}\n",
  },
  {
    id: "width",
    label: "@media screen and (max-width: …)",
    code: "@media screen and (max-width: 600px) {\n  \n}\n",
  },
]

const CSS_PLACEHOLDER = `/* You can style your email using global selectors:

p { color: red; }

Or you can also add a custom class for a specific element:

.example { color: blue; } */`

function PanelHeader({
  title,
  icon: Icon,
  onClose,
  closeLabel,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  onClose: () => void
  closeLabel: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={closeLabel}
        data-testid="inspector-close"
        onClick={onClose}
      >
        {closeLabel === "Collapse panel" ? <PanelRightCloseIcon /> : <XIcon />}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------ style field */

type StyleInput = {
  label: string
  type: "color" | "number" | "select" | "text" | "textarea"
  unit?: string
  options?: Record<string, string>
  placeholder?: string
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number.parseFloat(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** One labelled control for one value, picked by the input's declared type.
    Theme groups and node panels both describe their values this way. */
function StyleField({
  input,
  value,
  testId,
  onValueChange,
}: {
  input: StyleInput
  value: string | number | undefined
  testId: string
  onValueChange: (value: string | number) => void
}) {
  const label = input.label
  let control: React.ReactNode
  if (input.type === "color") {
    control = (
      <ColorField
        value={String(value ?? "")}
        aria-label={label}
        data-testid={testId}
        onValueChange={onValueChange}
      />
    )
  } else if (input.type === "number") {
    control = (
      <NumberField
        value={toNumber(value)}
        unit={input.unit}
        placeholder={input.placeholder}
        aria-label={label}
        data-testid={testId}
        onValueChange={onValueChange}
      />
    )
  } else if (input.type === "select") {
    control = (
      <OptionSelect
        size="sm"
        className="w-full"
        aria-label={label}
        value={String(value ?? "")}
        items={Object.entries(input.options ?? {}).map(([key, text]) => ({
          value: key,
          label: text,
        }))}
        onChange={onValueChange}
      />
    )
  } else if (input.type === "textarea") {
    control = (
      <Textarea
        rows={3}
        value={String(value ?? "")}
        aria-label={label}
        data-testid={testId}
        onChange={(event) => onValueChange(event.target.value)}
      />
    )
  } else {
    control = (
      <Input
        value={String(value ?? "")}
        className="h-control-sm"
        placeholder={input.placeholder}
        aria-label={label}
        data-testid={testId}
        onChange={(event) => onValueChange(event.target.value)}
      />
    )
  }
  return (
    <InspectorRow
      label={label}
      align={input.type === "textarea" ? "start" : undefined}
    >
      {control}
    </InspectorRow>
  )
}

/* ------------------------------------------------------------- node panel */

type StyleContext = Pick<
  InspectorNodeContext | InspectorTextContext,
  "getStyle" | "setStyle"
>

function StyleRows({
  context,
  props,
}: {
  context: StyleContext
  props: readonly KnownCssProperties[]
}) {
  return props.map((prop) => (
    <StyleField
      key={prop}
      input={SUPPORTED_CSS_PROPERTIES[prop]}
      value={context.getStyle(prop)}
      testId={`inspector-${prop}`}
      onValueChange={(value) => context.setStyle(prop, value)}
    />
  ))
}

const TYPOGRAPHY: readonly KnownCssProperties[] = [
  "color",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
]

const BORDER: readonly KnownCssProperties[] = [
  "borderRadius",
  "borderWidth",
  "borderStyle",
  "borderColor",
]

type NodeSection =
  | "attributes"
  | "link"
  | "size"
  | "typography"
  | "padding"
  | "background"
  | "border"

/* Which groups a node offers, in the engine's own order. */
function nodeSections(nodeType: string): NodeSection[] {
  switch (nodeType) {
    case "image":
      return ["attributes", "size", "link", "padding", "border"]
    case "button":
      return ["link", "typography", "size", "padding", "border", "background"]
    case "section":
    case "div":
      return ["background", "padding", "border"]
    case "codeBlock":
      return ["padding", "border"]
    case "youtube":
    case "spacer":
    case "html":
    case "variable":
      return ["attributes"]
    case "footer":
      return ["typography", "padding", "background"]
    default:
      return ["typography", "padding", "background", "border"]
  }
}

function PaddingRow({ context }: { context: InspectorNodeContext }) {
  const all = toNumber(context.getStyle("padding")) ?? 0
  const side = (prop: KnownCssProperties) =>
    toNumber(context.getStyle(prop)) ?? all
  const value: BoxValue = {
    top: side("paddingTop"),
    right: side("paddingRight"),
    bottom: side("paddingBottom"),
    left: side("paddingLeft"),
  }
  return (
    <InspectorRow label="Padding" align="start">
      <BoxField
        value={value}
        min={0}
        label="Padding"
        data-testid="inspector-padding"
        onValueChange={(next) =>
          context.batchSetStyle([
            { prop: "paddingTop", value: next.top },
            { prop: "paddingRight", value: next.right },
            { prop: "paddingBottom", value: next.bottom },
            { prop: "paddingLeft", value: next.left },
          ])
        }
      />
    </InspectorRow>
  )
}

function AttrField({
  context,
  name,
  label,
  type = "text",
}: {
  context: InspectorNodeContext
  name: string
  label: string
  type?: StyleInput["type"]
}) {
  return (
    <StyleField
      input={{ label, type }}
      value={(context.getAttr(name) as string | number | undefined) ?? ""}
      testId={`inspector-${name}`}
      onValueChange={(value) => context.setAttr(name, value)}
    />
  )
}

/* The values a node keeps as attributes rather than styles. */
const NODE_ATTRIBUTES: Record<
  string,
  { name: string; label: string; type?: StyleInput["type"] }[]
> = {
  image: [
    { name: "src", label: "Image URL" },
    { name: "alt", label: "Alt text", type: "textarea" },
  ],
  youtube: [
    { name: "video", label: "Video URL" },
    { name: "alt", label: "Alt text" },
    { name: "width", label: "Width", type: "number" },
  ],
  spacer: [{ name: "height", label: "Height", type: "number" }],
  html: [{ name: "code", label: "HTML", type: "textarea" }],
  variable: [
    { name: "name", label: "Variable" },
    { name: "fallback", label: "Fallback" },
  ],
}

/* Names for our own nodes; the engine names its own. */
const NODE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  spacer: "Spacer",
  html: "HTML",
  variable: "Variable",
  footer: "Footer",
}

function NodePanel({ context }: { context: InspectorNodeContext }) {
  const alignment = context.getAttr("alignment")
  return nodeSections(context.nodeType).map((section, index) => (
    <React.Fragment key={section}>
      {index > 0 ? <Separator /> : null}
      <InspectorSection>
        {section === "attributes"
          ? (NODE_ATTRIBUTES[context.nodeType] ?? []).map((field) => (
              <AttrField key={field.name} context={context} {...field} />
            ))
          : null}
        {section === "link" ? (
          <AttrField context={context} name="href" label="URL" />
        ) : null}
        {section === "size" ? (
          context.nodeType === "image" ? (
            <>
              <AttrField
                context={context}
                name="width"
                label="Width"
                type="number"
              />
              <AttrField
                context={context}
                name="height"
                label="Height"
                type="number"
              />
            </>
          ) : (
            <StyleRows context={context} props={["width", "height"]} />
          )
        ) : null}
        {section === "typography" ? (
          <>
            {typeof alignment === "string" ? (
              <InspectorRow label="Alignment">
                <AlignField
                  value={alignment as EmailAlign}
                  testIdPrefix="inspector-align"
                  onValueChange={(next) => context.setAttr("alignment", next)}
                />
              </InspectorRow>
            ) : null}
            <StyleRows context={context} props={TYPOGRAPHY} />
          </>
        ) : null}
        {section === "padding" ? <PaddingRow context={context} /> : null}
        {section === "background" ? (
          <StyleRows context={context} props={["backgroundColor"]} />
        ) : null}
        {section === "border" ? (
          <StyleRows context={context} props={BORDER} />
        ) : null}
      </InspectorSection>
    </React.Fragment>
  ))
}

/* ------------------------------------------------------------- text panel */

const MARKS = [
  { name: "bold", label: "Bold", icon: BoldIcon },
  { name: "italic", label: "Italic", icon: ItalicIcon },
  { name: "underline", label: "Underline", icon: UnderlineIcon },
  { name: "strike", label: "Strikethrough", icon: StrikethroughIcon },
]

function TextPanel({ context }: { context: InspectorTextContext }) {
  return (
    <>
      <InspectorSection>
        <InspectorRow label="Format">
          <div className="flex gap-0.5">
            {MARKS.map(({ name, label, icon: Icon }) => (
              <Toggle
                key={name}
                size="sm"
                aria-label={label}
                pressed={Boolean(context.marks[name])}
                data-testid={`inspector-mark-${name}`}
                onPressedChange={() => context.toggleMark(name)}
              >
                <Icon />
              </Toggle>
            ))}
          </div>
        </InspectorRow>
        <InspectorRow label="Alignment">
          <AlignField
            value={(context.alignment || "left") as EmailAlign}
            testIdPrefix="inspector-text-align"
            onValueChange={context.setAlignment}
          />
        </InspectorRow>
        <StyleRows context={context} props={["color", "fontSize"]} />
      </InspectorSection>
      {context.isLinkActive ? (
        <>
          <Separator />
          <InspectorSection title="Link">
            <StyleField
              input={{ label: "URL", type: "text" }}
              value={context.linkHref}
              testId="inspector-link-href"
              onValueChange={() => {}}
            />
            <StyleField
              input={{ label: "Color", type: "color" }}
              value={context.linkColor}
              testId="inspector-link-color"
              onValueChange={(color) => context.setLinkColor(String(color))}
            />
          </InspectorSection>
        </>
      ) : null}
    </>
  )
}

/* -------------------------------------------------- page, theme, global css */

function GlobalCssPanel() {
  const { editor } = useCurrentEditor()
  const css = useEmailTheming(editor)?.css ?? ""

  function setCss(next: string) {
    if (editor) setGlobalCssInjected(editor, next)
  }

  return (
    <InspectorSection className="gap-3">
      <CodeEditor
        value={css}
        placeholder={CSS_PLACEHOLDER}
        aria-label="Global CSS"
        data-testid="global-css"
        className="h-72"
        onValueChange={setCss}
      />
      <div className="flex flex-wrap gap-1.5">
        {CSS_SNIPPETS.map((snippet) => (
          <Button
            key={snippet.id}
            variant="outline"
            size="xs"
            data-testid={`global-css-snippet-${snippet.id}`}
            onClick={() =>
              setCss(
                `${css}${css.endsWith("\n") || !css ? "" : "\n"}${snippet.code}`
              )
            }
          >
            <PlusIcon data-icon="inline-start" />
            {snippet.label}
          </Button>
        ))}
      </div>
    </InspectorSection>
  )
}

type ThemeInputs = PanelGroup["inputs"]

type InspectorDocumentContext = Parameters<
  NonNullable<InspectorDocumentProps["children"]>
>[0]

const PADDING_SIDES = {
  paddingTop: "top",
  paddingRight: "right",
  paddingBottom: "bottom",
  paddingLeft: "left",
} as const

function isPaddingSide(prop: string): prop is keyof typeof PADDING_SIDES {
  return prop in PADDING_SIDES
}

/* A theme group's inputs as rows. The four padding sides arrive as separate
   inputs and are shown as one box, where the first of them sits. */
function ThemeGroupRows({
  inputs,
  setGlobalStyle,
  batchSetGlobalStyle,
}: {
  inputs: ThemeInputs
  setGlobalStyle: InspectorDocumentContext["setGlobalStyle"]
  batchSetGlobalStyle: InspectorDocumentContext["batchSetGlobalStyle"]
}) {
  const sides = inputs.filter((input) => isPaddingSide(input.prop))
  const box: BoxValue = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const input of sides) {
    if (isPaddingSide(input.prop)) {
      box[PADDING_SIDES[input.prop]] = toNumber(input.value) ?? 0
    }
  }

  return inputs.map((input) => {
    const target = input.classReference
    if (!target) return null
    if (isPaddingSide(input.prop)) {
      if (input !== sides[0] || sides.length < 4) return null
      return (
        <InspectorRow key="padding" label="Padding" align="start">
          <BoxField
            value={box}
            min={0}
            label="Padding"
            data-testid={`theme-${target}-padding`}
            onValueChange={(next) =>
              batchSetGlobalStyle(
                sides.map((side) => ({
                  classReference: target,
                  property: side.prop,
                  value: isPaddingSide(side.prop)
                    ? next[PADDING_SIDES[side.prop]]
                    : 0,
                }))
              )
            }
          />
        </InspectorRow>
      )
    }
    return (
      <StyleField
        key={input.prop}
        input={input}
        value={input.value}
        testId={`theme-${target}-${input.prop}`}
        onValueChange={(value) => setGlobalStyle(target, input.prop, value)}
      />
    )
  })
}

/* The page and the paper are the theme's first two groups; the rest are the
   per-element groups the theme panel lists. */
const PAGE_GROUPS = new Set(["body", "container"])

export function Inspector({ onCollapse }: { onCollapse: () => void }) {
  const [panel, setPanel] = React.useState<"page" | "theme" | "css">("page")
  const { editor } = useCurrentEditor()

  /* The engine mounts after the first paint, and its inspector hooks expect
     it to be there. */
  if (!editor) {
    return (
      <aside className="h-full w-72 shrink-0 border-l border-border bg-background" />
    )
  }

  return (
    <EngineInspector.Root asChild>
      <aside
        data-testid="editor-inspector"
        className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background outline-none"
      >
        {panel === "css" ? (
          <>
            <PanelHeader
              title="Global CSS"
              icon={BracesIcon}
              closeLabel="Back to page style"
              onClose={() => setPanel("page")}
            />
            <ScrollArea className="min-h-0 flex-1">
              <GlobalCssPanel />
            </ScrollArea>
          </>
        ) : (
          <>
            <EngineInspector.Document>
              {(context) => (
                <>
                  <PanelHeader
                    title={panel === "theme" ? "Theme" : "Page style"}
                    icon={panel === "theme" ? PaletteIcon : FileIcon}
                    closeLabel={
                      panel === "theme"
                        ? "Back to page style"
                        : "Collapse panel"
                    }
                    onClose={
                      panel === "theme" ? () => setPanel("page") : onCollapse
                    }
                  />
                  <ScrollArea className="min-h-0 flex-1">
                    {context.styles
                      .filter(
                        (group) =>
                          PAGE_GROUPS.has(group.id ?? "") === (panel === "page")
                      )
                      .map((group, index) => (
                        <React.Fragment key={group.id ?? group.title}>
                          {index > 0 ? <Separator /> : null}
                          <InspectorSection title={getPanelTitle(group)}>
                            <ThemeGroupRows
                              inputs={group.inputs}
                              setGlobalStyle={context.setGlobalStyle}
                              batchSetGlobalStyle={context.batchSetGlobalStyle}
                            />
                          </InspectorSection>
                        </React.Fragment>
                      ))}
                    {panel === "page" ? (
                      <>
                        <Separator />
                        <div className="flex flex-col p-1.5">
                          <Button
                            variant="ghost"
                            className="justify-start"
                            data-testid="inspector-edit-theme"
                            onClick={() => setPanel("theme")}
                          >
                            <PaletteIcon data-icon="inline-start" />
                            Edit theme
                          </Button>
                          <Button
                            variant="ghost"
                            className="justify-start"
                            data-testid="inspector-global-css"
                            onClick={() => setPanel("css")}
                          >
                            <BracesIcon data-icon="inline-start" />
                            Global CSS
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </ScrollArea>
                </>
              )}
            </EngineInspector.Document>
            <EngineInspector.Node>
              {(context) => (
                <>
                  <PanelHeader
                    title={
                      NODE_LABELS[context.nodeType] ??
                      getNodeMeta(context.nodeType).label
                    }
                    icon={SquareIcon}
                    closeLabel="Collapse panel"
                    onClose={onCollapse}
                  />
                  <ScrollArea className="min-h-0 flex-1">
                    <NodePanel context={context} />
                  </ScrollArea>
                </>
              )}
            </EngineInspector.Node>
            <EngineInspector.Text>
              {(context) => (
                <>
                  <PanelHeader
                    title="Text"
                    icon={TypeIcon}
                    closeLabel="Collapse panel"
                    onClose={onCollapse}
                  />
                  <ScrollArea className="min-h-0 flex-1">
                    <TextPanel context={context} />
                  </ScrollArea>
                </>
              )}
            </EngineInspector.Text>
          </>
        )}
      </aside>
    </EngineInspector.Root>
  )
}
