"use client"

import * as React from "react"
import {
  getPanelTitle,
  setCurrentTheme,
  setGlobalCssInjected,
  SUPPORTED_CSS_PROPERTIES,
  useEmailTheming,
  type EditorTheme,
  type KnownCssProperties,
  type PanelGroup,
  type PanelSectionId,
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
  BracesIcon,
  FileIcon,
  PaletteIcon,
  PanelRightCloseIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  XIcon,
} from "lucide-react"

import { BoxField, type BoxValue } from "@/components/ui/box-field"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ColorField } from "@/components/ui/color-field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { NumberField } from "@/components/ui/number-field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { useDraftValue } from "@/components/dashboard/primitives"
import { normalizeHref } from "@/lib/dashboard/format"
import { CodeEditor } from "@/components/dashboard/broadcasts/editor/code-editor"
import {
  AlignField,
  InspectorRow,
  InspectorSection,
  SegmentedToggle,
  TEXT_MARKS,
  type EmailAlign,
  type SegmentedItem,
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
  back = false,
  actions,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  onClose: () => void
  /** Buttons that act on what the panel is showing. */
  actions?: React.ReactNode
  /** The panel sits on top of Page style and closes back to it, rather than
      collapsing the whole inspector. */
  back?: boolean
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      {actions}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={back ? "Back to page style" : "Collapse panel"}
        data-testid="inspector-close"
        onClick={onClose}
      >
        {back ? <XIcon /> : <PanelRightCloseIcon />}
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
  clearable = true,
}: {
  input: StyleInput
  value: string | number | undefined
  testId: string
  onValueChange: (value: string | number) => void
  /** A style is optional, so emptying its number unsets it. A node's own
      size is not, and springs back. */
  clearable?: boolean
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
        onClear={clearable ? () => onValueChange("") : undefined}
      />
    )
  } else if (input.type === "select") {
    /* A native select, on purpose. A popup select renders in a portal, and
       the engine reads focus leaving for a portal as "clicked away": it drops
       the selection and this panel is swapped out from under the open menu. */
    control = (
      <NativeSelect
        size="sm"
        className="w-full"
        aria-label={label}
        data-testid={testId}
        value={String(value ?? "")}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {/* A value the list does not hold (unset, say) still has to show. */}
        {value === undefined ||
        String(value) in (input.options ?? {}) ? null : (
          <NativeSelectOption value={String(value)}>
            {String(value)}
          </NativeSelectOption>
        )}
        {/* The way back to unset, where the value is optional. */}
        {value === undefined || clearable ? (
          <NativeSelectOption value="">
            {value === undefined ? "" : "Default"}
          </NativeSelectOption>
        ) : null}
        {Object.entries(input.options ?? {}).map(([key, text]) => (
          <NativeSelectOption key={key} value={key}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
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
    /* The row itself keeps no styles in the engine, only the gap between its
       columns; each column, or a section around the row, takes the rest. */
    case "twoColumns":
    case "threeColumns":
    case "fourColumns":
      return ["attributes"]
    case "columnsColumn":
      return ["size", "typography", "padding", "background", "border"]
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

/* How a column's content sits against taller neighbours. The engine keeps no
   list entry for it, but writes and exports any style it is handed. */
const VERTICAL_ALIGN = "verticalAlign" as KnownCssProperties

const VERTICAL_ALIGN_INPUT: StyleInput = {
  label: "Vertical",
  type: "select",
  options: { top: "Top", middle: "Middle", bottom: "Bottom" },
}

function VerticalAlignRow({ context }: { context: InspectorNodeContext }) {
  return (
    <StyleField
      input={VERTICAL_ALIGN_INPUT}
      value={context.getStyle(VERTICAL_ALIGN) ?? "middle"}
      testId="inspector-verticalAlign"
      onValueChange={(value) => context.setStyle(VERTICAL_ALIGN, value)}
    />
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
  type?: StyleInput["type"] | "align"
}) {
  if (type === "align") {
    return (
      <InspectorRow label={label}>
        <AlignField
          value={(context.getAttr(name) ?? "left") as EmailAlign}
          testIdPrefix={`inspector-${name}`}
          onValueChange={(next) => context.setAttr(name, next)}
        />
      </InspectorRow>
    )
  }
  const stored = (context.getAttr(name) as string | number | undefined) ?? ""
  if (type === "textarea") {
    return (
      <DraftedAttrField
        label={label}
        testId={`inspector-${name}`}
        value={String(stored)}
        onCommit={(value) => context.setAttr(name, value)}
      />
    )
  }
  return (
    <StyleField
      input={{ label, type }}
      value={stored}
      clearable={false}
      testId={`inspector-${name}`}
      onValueChange={(value) => {
        /* A destination that is not safe to send is not stored. */
        const next = name === "href" ? normalizeHref(String(value)) : value
        if (next !== null) context.setAttr(name, next)
      }}
    />
  )
}

/* Long text (an HTML block's markup, alt text) stays in a draft until the
   field is left: each commit is a document change that repaints the block
   and restarts the save, which is too much to do per keystroke. */
function DraftedAttrField({
  label,
  testId,
  value,
  onCommit,
}: {
  label: string
  testId: string
  value: string
  onCommit: (value: string) => void
}) {
  const { draft, setDraft, commitDraft } = useDraftValue(value, onCommit)
  return (
    <InspectorRow label={label} align="start">
      <Textarea
        rows={3}
        value={draft}
        aria-label={label}
        data-testid={testId}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
      />
    </InspectorRow>
  )
}

const COLUMN_SPACING = [
  { name: "cellspacing", label: "Column gap", type: "number" as const },
]

/* The values a node keeps as attributes rather than styles. */
const NODE_ATTRIBUTES: Record<
  string,
  { name: string; label: string; type?: StyleInput["type"] | "align" }[]
> = {
  image: [
    { name: "alignment", label: "Alignment", type: "align" },
    { name: "src", label: "Image URL" },
    { name: "alt", label: "Alt text", type: "textarea" },
  ],
  youtube: [
    { name: "alignment", label: "Alignment", type: "align" },
    { name: "video", label: "Video URL" },
    { name: "alt", label: "Alt text" },
    { name: "width", label: "Width", type: "number" },
  ],
  spacer: [{ name: "height", label: "Height", type: "number" }],
  twoColumns: COLUMN_SPACING,
  threeColumns: COLUMN_SPACING,
  fourColumns: COLUMN_SPACING,
  html: [{ name: "code", label: "HTML", type: "textarea" }],
  variable: [
    { name: "name", label: "Variable" },
    { name: "fallback", label: "Fallback" },
  ],
}

/* Names for our own nodes, and for the layout nodes the engine leaves
   unnamed; it names the rest. */
const NODE_LABELS: Record<string, string> = {
  twoColumns: "Columns",
  threeColumns: "Columns",
  fourColumns: "Columns",
  columnsColumn: "Column",
  youtube: "YouTube",
  spacer: "Spacer",
  html: "HTML",
  variable: "Variable",
}

function nodeLabel(nodeType: string): string {
  return nodeType === "body"
    ? "Page"
    : (NODE_LABELS[nodeType] ?? getNodeMeta(nodeType).label)
}

/* The way out to what encloses the selection. A click inside a section or a
   column always lands on the text in it, so this is the only path to the
   section, the column or the page themselves. */
function SelectionPath() {
  return (
    <EngineInspector.Breadcrumb>
      {(all) => {
        /* The container is the paper, which "Page" already stands for. */
        const segments = all.filter(
          (segment) => segment.node.nodeType !== "container"
        )
        return segments.length < 2 ? null : (
          <Breadcrumb
            className="border-b border-border px-3 py-1.5"
            data-testid="inspector-path"
          >
            <BreadcrumbList className="gap-1 text-xs sm:gap-1">
              {segments.map((segment, index) => {
                const last = index === segments.length - 1
                const label = nodeLabel(segment.node.nodeType)
                return (
                  <React.Fragment key={`${segment.node.nodeType}-${index}`}>
                    {index > 0 ? <BreadcrumbSeparator /> : null}
                    <BreadcrumbItem>
                      {last ? (
                        <BreadcrumbPage>{label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          render={<button type="button" />}
                          onClick={segment.focus}
                        >
                          {label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )
      }}
    </EngineInspector.Breadcrumb>
  )
}

/* A block whose inside takes the caret (a button, a section, a column) has
   no key that removes it without eating into its neighbours first. */
function DeleteNodeButton({ context }: { context: InspectorNodeContext }) {
  const { editor } = useCurrentEditor()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Delete ${nodeLabel(context.nodeType).toLowerCase()}`}
      title="Delete"
      data-testid="inspector-delete"
      onClick={() => {
        const { pos } = context.nodePos
        const node = editor?.state.doc.nodeAt(pos)
        if (!editor || !node) return
        editor
          .chain()
          .focus()
          .deleteRange({ from: pos, to: pos + node.nodeSize })
          .run()
      }}
    >
      <Trash2Icon />
    </Button>
  )
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
          ) : context.nodeType === "columnsColumn" ? (
            <>
              <StyleRows context={context} props={["width"]} />
              <VerticalAlignRow context={context} />
            </>
          ) : (
            <StyleRows context={context} props={["width", "height"]} />
          )
        ) : null}
        {section === "typography" ? (
          <>
            {/* Null means "not set yet"; undefined means the node has no
                such attribute. */}
            {alignment !== undefined ? (
              <InspectorRow label="Alignment">
                <AlignField
                  value={(alignment ?? "left") as EmailAlign}
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

/* Inline code is set from the bubble toolbar; the panel keeps the four
   character styles. */
const PANEL_MARKS = TEXT_MARKS.filter((mark) => mark.name !== "code")

function TextPanel({ context }: { context: InspectorTextContext }) {
  return (
    <>
      <InspectorSection>
        <InspectorRow label="Format">
          <div className="flex gap-0.5">
            {PANEL_MARKS.map(({ name, label, icon: Icon }) => (
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
            {/* Shown only: the engine gives this panel the link's colour to
                set, and its address is edited from the link's own toolbar. */}
            <InspectorRow label="URL">
              <p
                className="truncate text-sm text-muted-foreground"
                data-testid="inspector-link-href"
              >
                {context.linkHref}
              </p>
            </InspectorRow>
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
  /* Every commit is a document change that every open panel reacts to, so
     typing stays in a draft until the field is left. */
  const { draft, setDraft, commitDraft } = useDraftValue(css, setCss)

  function setCss(next: string) {
    if (editor) setGlobalCssInjected(editor, next)
  }

  return (
    <InspectorSection className="gap-3">
      <CodeEditor
        value={draft}
        placeholder={CSS_PLACEHOLDER}
        aria-label="Global CSS"
        data-testid="global-css"
        className="h-72"
        onValueChange={setDraft}
        onBlur={commitDraft}
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
                `${draft}${draft.endsWith("\n") || !draft ? "" : "\n"}${snippet.code}`
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

type PaddingSide = keyof typeof PADDING_SIDES

function isPaddingSide(prop: string): prop is PaddingSide {
  return prop in PADDING_SIDES
}

/* A theme group's inputs as rows. The four padding sides arrive as separate
   inputs and are shown as one box, where the first of them sits. */
function ThemeGroupRows({
  group,
  inputs,
  setGlobalStyle,
  batchSetGlobalStyle,
}: {
  /** The element the group styles; an input may name its own instead. */
  group: PanelGroup["classReference"]
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
    const target = input.classReference ?? group
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

const TEXT_PROPS: readonly KnownCssProperties[] = [
  ...TYPOGRAPHY,
  "textDecoration",
]

const PADDING_PROPS = Object.keys(PADDING_SIDES) as PaddingSide[]

/* The theme sets one border for an element; its style is a per-block choice. */
const FRAME_PROPS = BORDER.filter((prop) => prop !== "borderStyle")

/* What each element group offers in the theme panel. The engine only lists
   the values a theme sets, and its minimal theme sets none, so the panel
   would otherwise be a column of empty headings. */
const THEME_GROUP_PROPS: Partial<
  Record<PanelSectionId, readonly KnownCssProperties[]>
> = {
  typography: TEXT_PROPS,
  h1: [...TEXT_PROPS, ...PADDING_PROPS],
  h2: [...TEXT_PROPS, ...PADDING_PROPS],
  h3: [...TEXT_PROPS, ...PADDING_PROPS],
  paragraph: [...TEXT_PROPS, ...PADDING_PROPS],
  list: TEXT_PROPS,
  "nested-list": TEXT_PROPS,
  "list-item": TEXT_PROPS,
  link: TEXT_PROPS,
  image: FRAME_PROPS,
  button: ["backgroundColor", ...TEXT_PROPS, ...PADDING_PROPS, ...FRAME_PROPS],
  "code-block": [
    "backgroundColor",
    ...TEXT_PROPS,
    ...PADDING_PROPS,
    ...FRAME_PROPS,
  ],
  "inline-code": ["backgroundColor", ...TEXT_PROPS, ...FRAME_PROPS],
}

/** A group's rows: the fixed set for an element group, else what the engine
    lists (the page and the paper). Values come from the engine either way. */
function themeInputs(
  group: PanelGroup,
  findStyleValue: InspectorDocumentContext["findStyleValue"]
): ThemeInputs {
  const props = group.id ? THEME_GROUP_PROPS[group.id] : undefined
  const target = group.classReference
  if (!props || !target) return group.inputs
  return props.map((prop) => ({
    ...SUPPORTED_CSS_PROPERTIES[prop],
    prop,
    classReference: target,
    value: findStyleValue(target, prop),
  }))
}

const THEME_PRESETS: SegmentedItem<EditorTheme>[] = [
  { value: "basic", label: "Basic" },
  { value: "minimal", label: "Minimal" },
]

/* The starting point the element groups below adjust. Basic brings a font,
   a base size and spacing; minimal leaves all of that to the author. */
function ThemePresetToggle() {
  const { editor } = useCurrentEditor()
  const theme = useEmailTheming(editor)?.theme
  if (!editor || !theme) return null
  return (
    <InspectorSection>
      <SegmentedToggle
        value={theme}
        items={THEME_PRESETS}
        aria-label="Theme preset"
        testIdPrefix="theme-preset"
        /* A preset is taken whole: its own values replace the ones kept in
           the document, which would otherwise sit on top and change nothing.
           The screen then remounts on the new preset. */
        onValueChange={(next) => {
          editor.commands.setGlobalContent("styles", null)
          setCurrentTheme(editor, next)
        }}
      />
    </InspectorSection>
  )
}

/* The page and the paper are the theme's first two groups; the rest are the
   per-element groups the theme panel lists. */
const PAGE_GROUPS: ReadonlySet<PanelSectionId | undefined> = new Set([
  "body",
  "container",
])

/* Memoised: the theme panel is a long list, and nothing the editor screen
   re-renders for (a save, the view toggle) concerns it. */
export const Inspector = React.memo(function Inspector({
  onCollapse,
}: {
  onCollapse: () => void
}) {
  const [panel, setPanel] = React.useState<"page" | "theme" | "css">("page")
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
              back
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
                    back={panel === "theme"}
                    onClose={
                      panel === "theme" ? () => setPanel("page") : onCollapse
                    }
                  />
                  <ScrollArea className="min-h-0 flex-1">
                    {panel === "theme" ? (
                      <>
                        <ThemePresetToggle />
                        <Separator />
                      </>
                    ) : null}
                    {context.styles
                      .filter(
                        (group) =>
                          PAGE_GROUPS.has(group.id) === (panel === "page")
                      )
                      .map((group, index) => (
                        <React.Fragment key={group.id ?? group.title}>
                          {index > 0 ? <Separator /> : null}
                          <InspectorSection title={getPanelTitle(group)}>
                            <ThemeGroupRows
                              group={group.classReference}
                              inputs={themeInputs(
                                group,
                                context.findStyleValue
                              )}
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
                    title={nodeLabel(context.nodeType)}
                    icon={SquareIcon}
                    onClose={onCollapse}
                    actions={<DeleteNodeButton context={context} />}
                  />
                  <SelectionPath />
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
                    onClose={onCollapse}
                  />
                  <SelectionPath />
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
})
