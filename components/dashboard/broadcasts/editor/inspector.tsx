"use client"

import * as React from "react"
import {
  BracesIcon,
  CaseSensitiveIcon,
  FileIcon,
  PaletteIcon,
  PanelRightCloseIcon,
  PlusIcon,
  RotateCcwIcon,
  StrikethroughIcon,
  Trash2Icon,
  UnderlineIcon,
  XIcon,
} from "lucide-react"

import { BoxField } from "@/components/ui/box-field"
import { Button } from "@/components/ui/button"
import { ColorField } from "@/components/ui/color-field"
import { NumberField } from "@/components/ui/number-field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/dashboard/primitives"
import { blockEntry } from "@/components/dashboard/broadcasts/editor/blocks"
import { CodeEditor } from "@/components/dashboard/broadcasts/editor/code-editor"
import {
  AlignField,
  InspectorRow,
  InspectorSection,
  SegmentedToggle,
  type SegmentedItem,
} from "@/components/dashboard/broadcasts/editor/controls"
import {
  COLUMN_COUNTS,
  FONT_WEIGHTS,
  findBlock,
  headingStyleKey,
  removeBlock,
  resetThemeStyle,
  setColumnCount,
  setDocumentStyle,
  setThemePreset,
  setThemeStyle,
  updateBlock,
  type ButtonBlock,
  type CodeBlock,
  type ColumnCount,
  type ColumnsBlock,
  type DividerBlock,
  type EmailBlock,
  type EmailDocument,
  type FontWeight,
  type FooterBlock,
  type HeadingBlock,
  type HtmlBlock,
  type ImageBlock,
  type ListBlock,
  type SocialBlock,
  type SpacerBlock,
  type TableBlock,
  type TextBlock,
  type TextDecoration,
  type ThemeStyleKey,
  type YoutubeBlock,
  THEME_STYLE_KEYS,
  THEME_STYLE_LABELS,
} from "@/lib/dashboard/email-document"

/* One panel, three faces: page and body style when nothing is selected, the
   selected block's properties, and the theme / global CSS editors reached
   from the bottom of the page panel. Every row is built from the same handful
   of controls. */

type Apply = (
  next: EmailDocument | ((doc: EmailDocument) => EmailDocument)
) => void

const DECORATIONS: SegmentedItem<TextDecoration>[] = [
  { value: "none", label: "No decoration", icon: CaseSensitiveIcon },
  { value: "underline", label: "Underline", icon: UnderlineIcon },
  { value: "line-through", label: "Strikethrough", icon: StrikethroughIcon },
]

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

/* --------------------------------------------------------- page and body */

function PageStylePanel({
  doc,
  apply,
  onOpenTheme,
  onOpenCss,
}: {
  doc: EmailDocument
  apply: Apply
  onOpenTheme: () => void
  onOpenCss: () => void
}) {
  const page = doc.style.page
  const body = doc.style.body

  return (
    <>
      <InspectorSection>
        <InspectorRow label="Background">
          <ColorField
            value={page.background}
            aria-label="Page background"
            data-testid="inspector-page-background"
            onValueChange={(background) =>
              apply((current) =>
                setDocumentStyle(current, { page: { background } })
              )
            }
          />
        </InspectorRow>
        <InspectorRow label="Padding" align="start">
          <BoxField
            value={page.padding}
            label="Page padding"
            min={0}
            data-testid="inspector-page-padding"
            onValueChange={(padding) =>
              apply((current) =>
                setDocumentStyle(current, { page: { padding } })
              )
            }
          />
        </InspectorRow>
      </InspectorSection>
      <Separator />
      <InspectorSection title="Body">
        <InspectorRow label="Alignment">
          <AlignField
            value={body.align}
            testIdPrefix="inspector-body-align"
            onValueChange={(align) =>
              apply((current) => setDocumentStyle(current, { body: { align } }))
            }
          />
        </InspectorRow>
        <InspectorRow label="Text">
          <ColorField
            value={body.color}
            aria-label="Body text colour"
            data-testid="inspector-body-color"
            onValueChange={(color) =>
              apply((current) => setDocumentStyle(current, { body: { color } }))
            }
          />
        </InspectorRow>
        <InspectorRow label="Background">
          <ColorField
            value={body.background}
            aria-label="Body background"
            data-testid="inspector-body-background"
            onValueChange={(background) =>
              apply((current) =>
                setDocumentStyle(current, { body: { background } })
              )
            }
          />
        </InspectorRow>
        <InspectorRow label="Width">
          <NumberField
            value={body.width}
            min={240}
            max={1200}
            aria-label="Body width"
            data-testid="inspector-body-width"
            onValueChange={(width) =>
              apply((current) => setDocumentStyle(current, { body: { width } }))
            }
          />
        </InspectorRow>
        <InspectorRow label="Height">
          <NumberField
            value={null}
            placeholder="auto"
            disabled
            aria-label="Body height"
            data-testid="inspector-body-height"
            onValueChange={() => undefined}
          />
        </InspectorRow>
        <InspectorRow label="Padding" align="start">
          <BoxField
            value={body.padding}
            label="Body padding"
            min={0}
            data-testid="inspector-body-padding"
            onValueChange={(padding) =>
              apply((current) =>
                setDocumentStyle(current, { body: { padding } })
              )
            }
          />
        </InspectorRow>
        <InspectorRow label="Margin" align="start">
          <BoxField
            value={body.margin}
            label="Body margin"
            min={0}
            data-testid="inspector-body-margin"
            onValueChange={(margin) =>
              apply((current) =>
                setDocumentStyle(current, { body: { margin } })
              )
            }
          />
        </InspectorRow>
        <InspectorRow label="Corner radius">
          <NumberField
            value={body.radius}
            min={0}
            aria-label="Corner radius"
            data-testid="inspector-body-radius"
            onValueChange={(radius) =>
              apply((current) =>
                setDocumentStyle(current, { body: { radius } })
              )
            }
          />
        </InspectorRow>
        <InspectorRow label="Border">
          <NumberField
            value={body.borderWidth}
            min={0}
            max={12}
            aria-label="Border width"
            data-testid="inspector-body-border"
            onValueChange={(borderWidth) =>
              apply((current) =>
                setDocumentStyle(current, { body: { borderWidth } })
              )
            }
          />
        </InspectorRow>
        <InspectorRow label="Border color">
          <ColorField
            value={body.borderColor}
            aria-label="Border colour"
            data-testid="inspector-body-border-color"
            onValueChange={(borderColor) =>
              apply((current) =>
                setDocumentStyle(current, { body: { borderColor } })
              )
            }
          />
        </InspectorRow>
      </InspectorSection>
      <Separator />
      <div className="flex flex-col p-1.5">
        <Button
          variant="ghost"
          className="justify-start"
          data-testid="inspector-edit-theme"
          onClick={onOpenTheme}
        >
          <PaletteIcon data-icon="inline-start" />
          Edit theme
        </Button>
        <Button
          variant="ghost"
          className="justify-start"
          data-testid="inspector-global-css"
          onClick={onOpenCss}
        >
          <BracesIcon data-icon="inline-start" />
          Global CSS
        </Button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ theme */

function ThemeGroup({
  doc,
  apply,
  styleKey,
}: {
  doc: EmailDocument
  apply: Apply
  styleKey: ThemeStyleKey
}) {
  const style = doc.theme[styleKey]
  const showsPadding =
    styleKey === "title" || styleKey === "subtitle" || styleKey === "heading"

  return (
    <InspectorSection>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h3 className="text-caption font-medium">
          {THEME_STYLE_LABELS[styleKey]}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Reset ${THEME_STYLE_LABELS[styleKey]}`}
          data-testid={`theme-${styleKey}-reset`}
          onClick={() => apply((current) => resetThemeStyle(current, styleKey))}
        >
          <RotateCcwIcon />
        </Button>
      </div>
      <InspectorRow label="Color">
        <ColorField
          value={style.color}
          aria-label={`${THEME_STYLE_LABELS[styleKey]} colour`}
          data-testid={`theme-${styleKey}-color`}
          onValueChange={(color) =>
            apply((current) => setThemeStyle(current, styleKey, { color }))
          }
        />
      </InspectorRow>
      <InspectorRow label="Size">
        <NumberField
          value={style.fontSize}
          min={8}
          max={96}
          aria-label={`${THEME_STYLE_LABELS[styleKey]} size`}
          data-testid={`theme-${styleKey}-size`}
          onValueChange={(fontSize) =>
            apply((current) => setThemeStyle(current, styleKey, { fontSize }))
          }
        />
      </InspectorRow>
      <InspectorRow label="Weight">
        <OptionSelect
          size="sm"
          className="w-full"
          aria-label={`${THEME_STYLE_LABELS[styleKey]} weight`}
          value={String(style.fontWeight)}
          items={FONT_WEIGHTS.map((weight) => ({
            value: String(weight.value),
            label: weight.label,
          }))}
          onChange={(next) =>
            apply((current) =>
              setThemeStyle(current, styleKey, {
                fontWeight: Number(next) as FontWeight,
              })
            )
          }
        />
      </InspectorRow>
      <InspectorRow label="Height">
        <NumberField
          value={style.lineHeight}
          unit="%"
          min={80}
          max={300}
          aria-label={`${THEME_STYLE_LABELS[styleKey]} line height`}
          data-testid={`theme-${styleKey}-height`}
          onValueChange={(lineHeight) =>
            apply((current) => setThemeStyle(current, styleKey, { lineHeight }))
          }
        />
      </InspectorRow>
      <InspectorRow label="Spacing">
        <NumberField
          value={style.letterSpacing}
          min={-4}
          max={12}
          step={0.1}
          aria-label={`${THEME_STYLE_LABELS[styleKey]} letter spacing`}
          data-testid={`theme-${styleKey}-spacing`}
          onValueChange={(letterSpacing) =>
            apply((current) =>
              setThemeStyle(current, styleKey, { letterSpacing })
            )
          }
        />
      </InspectorRow>
      <InspectorRow label="Decoration">
        <SegmentedToggle
          value={style.decoration}
          items={DECORATIONS}
          aria-label={`${THEME_STYLE_LABELS[styleKey]} decoration`}
          testIdPrefix={`theme-${styleKey}-decoration`}
          onValueChange={(decoration) =>
            apply((current) => setThemeStyle(current, styleKey, { decoration }))
          }
        />
      </InspectorRow>
      {showsPadding ? (
        <InspectorRow label="Padding" align="start">
          <BoxField
            value={style.padding}
            min={0}
            label={`${THEME_STYLE_LABELS[styleKey]} padding`}
            data-testid={`theme-${styleKey}-padding`}
            onValueChange={(padding) =>
              apply((current) => setThemeStyle(current, styleKey, { padding }))
            }
          />
        </InspectorRow>
      ) : null}
    </InspectorSection>
  )
}

function ThemePanel({ doc, apply }: { doc: EmailDocument; apply: Apply }) {
  return (
    <>
      <InspectorSection>
        <SegmentedToggle
          value={doc.theme.preset}
          aria-label="Theme preset"
          testIdPrefix="theme-preset"
          items={[
            { value: "minimal", label: "Minimal" },
            { value: "basic", label: "Basic" },
          ]}
          onValueChange={(preset) =>
            apply((current) => setThemePreset(current, preset))
          }
        />
      </InspectorSection>
      {THEME_STYLE_KEYS.map((key) => (
        <React.Fragment key={key}>
          <Separator />
          <ThemeGroup doc={doc} apply={apply} styleKey={key} />
        </React.Fragment>
      ))}
    </>
  )
}

function GlobalCssPanel({ doc, apply }: { doc: EmailDocument; apply: Apply }) {
  return (
    <InspectorSection className="gap-3">
      <CodeEditor
        value={doc.globalCss}
        placeholder={CSS_PLACEHOLDER}
        aria-label="Global CSS"
        data-testid="global-css"
        className="h-72"
        onValueChange={(globalCss) =>
          apply((current) => ({ ...current, globalCss }))
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {CSS_SNIPPETS.map((snippet) => (
          <Button
            key={snippet.id}
            variant="outline"
            size="xs"
            data-testid={`global-css-snippet-${snippet.id}`}
            onClick={() =>
              apply((current) => ({
                ...current,
                globalCss: `${current.globalCss}${current.globalCss.endsWith("\n") || !current.globalCss ? "" : "\n"}${snippet.code}`,
              }))
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

/* ------------------------------------------------------------ block props */

/* A textarea whose text is parsed into structured data. While it has focus
   the raw draft is kept, because the parsed form drops what typing depends
   on: the space before the next word, the newline that starts the next row.
   Out of focus it shows the stored value again, normalised. */
function ParsedTextarea({
  text,
  onTextChange,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  text: string
  onTextChange: (text: string) => void
}) {
  const [draft, setDraft] = React.useState(text)
  const [focused, setFocused] = React.useState(false)
  if (!focused && draft !== text) setDraft(text)

  return (
    <Textarea
      {...props}
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setDraft(event.target.value)
        onTextChange(event.target.value)
      }}
    />
  )
}

function BlockInspector({
  doc,
  apply,
  block,
}: {
  doc: EmailDocument
  apply: Apply
  block: EmailBlock
}) {
  function patch<T extends EmailBlock>(next: Partial<T>) {
    apply((current) => updateBlock<T>(current, block.id, next))
  }

  const rows: React.ReactNode[] = []

  if ("align" in block) {
    rows.push(
      <InspectorRow key="align" label="Alignment">
        <AlignField
          value={block.align}
          testIdPrefix="inspector-align"
          onValueChange={(align) => patch({ align })}
        />
      </InspectorRow>
    )
  }

  switch (block.type) {
    case "heading":
      rows.unshift(
        <InspectorRow key="level" label="Level">
          <SegmentedToggle
            value={String(block.level)}
            aria-label="Heading level"
            testIdPrefix="inspector-heading-level"
            items={[
              { value: "1", label: "Title" },
              { value: "2", label: "Subtitle" },
              { value: "3", label: "Heading" },
            ]}
            onValueChange={(level) =>
              patch<HeadingBlock>({ level: Number(level) as 1 | 2 | 3 })
            }
          />
        </InspectorRow>
      )
      rows.push(
        <InspectorRow key="color" label="Color">
          <ColorField
            value={block.color ?? doc.theme[headingStyleKey(block.level)].color}
            aria-label="Heading colour"
            data-testid="inspector-heading-color"
            onValueChange={(color) => patch<HeadingBlock>({ color })}
          />
        </InspectorRow>,
        <InspectorRow key="size" label="Size">
          <NumberField
            value={
              block.fontSize ?? doc.theme[headingStyleKey(block.level)].fontSize
            }
            min={10}
            max={96}
            aria-label="Heading size"
            data-testid="inspector-heading-size"
            onValueChange={(fontSize) => patch<HeadingBlock>({ fontSize })}
          />
        </InspectorRow>,
        <InspectorRow key="padding" label="Padding" align="start">
          <BoxField
            value={
              block.padding ?? doc.theme[headingStyleKey(block.level)].padding
            }
            min={0}
            label="Heading padding"
            data-testid="inspector-heading-padding"
            onValueChange={(padding) => patch<HeadingBlock>({ padding })}
          />
        </InspectorRow>
      )
      break
    case "text":
    case "list":
      rows.push(
        <InspectorRow key="color" label="Color">
          <ColorField
            value={block.color ?? doc.theme.text.color}
            aria-label="Text colour"
            data-testid="inspector-text-color"
            onValueChange={(color) => patch<TextBlock>({ color })}
          />
        </InspectorRow>,
        <InspectorRow key="size" label="Size">
          <NumberField
            value={block.fontSize ?? doc.theme.text.fontSize}
            min={8}
            max={64}
            aria-label="Text size"
            data-testid="inspector-text-size"
            onValueChange={(fontSize) => patch<TextBlock>({ fontSize })}
          />
        </InspectorRow>,
        <InspectorRow key="padding" label="Padding" align="start">
          <BoxField
            value={block.padding}
            min={0}
            label="Text padding"
            data-testid="inspector-text-padding"
            onValueChange={(padding) => patch<TextBlock>({ padding })}
          />
        </InspectorRow>
      )
      if (block.type === "list") {
        rows.push(
          <InspectorRow key="ordered" label="Numbered">
            <Switch
              checked={block.ordered}
              aria-label="Numbered list"
              data-testid="inspector-list-ordered"
              onCheckedChange={(ordered) => patch<ListBlock>({ ordered })}
            />
          </InspectorRow>
        )
      }
      break
    case "button":
      rows.unshift(
        <InspectorRow key="label" label="Label">
          <Input
            value={block.label}
            className="h-control-sm"
            aria-label="Button label"
            data-testid="inspector-button-label"
            onChange={(event) =>
              patch<ButtonBlock>({ label: event.target.value })
            }
          />
        </InspectorRow>,
        <InspectorRow key="href" label="URL">
          <Input
            value={block.href}
            className="h-control-sm"
            aria-label="Button URL"
            data-testid="inspector-button-url"
            onChange={(event) =>
              patch<ButtonBlock>({ href: event.target.value })
            }
          />
        </InspectorRow>
      )
      rows.push(
        <InspectorRow key="bg" label="Background">
          <ColorField
            value={block.background}
            aria-label="Button background"
            data-testid="inspector-button-background"
            onValueChange={(background) => patch<ButtonBlock>({ background })}
          />
        </InspectorRow>,
        <InspectorRow key="color" label="Text">
          <ColorField
            value={block.color}
            aria-label="Button text colour"
            data-testid="inspector-button-color"
            onValueChange={(color) => patch<ButtonBlock>({ color })}
          />
        </InspectorRow>,
        <InspectorRow key="radius" label="Corner radius">
          <NumberField
            value={block.radius}
            min={0}
            aria-label="Button radius"
            data-testid="inspector-button-radius"
            onValueChange={(radius) => patch<ButtonBlock>({ radius })}
          />
        </InspectorRow>,
        <InspectorRow key="padding" label="Padding" align="start">
          <BoxField
            value={block.padding}
            min={0}
            label="Button padding"
            data-testid="inspector-button-padding"
            onValueChange={(padding) => patch<ButtonBlock>({ padding })}
          />
        </InspectorRow>,
        <InspectorRow key="full" label="Full width">
          <Switch
            checked={block.fullWidth}
            aria-label="Full width"
            data-testid="inspector-button-full-width"
            onCheckedChange={(fullWidth) => patch<ButtonBlock>({ fullWidth })}
          />
        </InspectorRow>
      )
      break
    case "image":
      rows.unshift(
        <InspectorRow key="src" label="Image URL">
          <Input
            value={block.src}
            className="h-control-sm"
            aria-label="Image URL"
            data-testid="inspector-image-src"
            onChange={(event) => patch<ImageBlock>({ src: event.target.value })}
          />
        </InspectorRow>,
        <InspectorRow key="alt" label="Alt text">
          <Input
            value={block.alt}
            className="h-control-sm"
            aria-label="Alt text"
            data-testid="inspector-image-alt"
            onChange={(event) => patch<ImageBlock>({ alt: event.target.value })}
          />
        </InspectorRow>,
        <InspectorRow key="href" label="Link">
          <Input
            value={block.href}
            className="h-control-sm"
            aria-label="Image link"
            data-testid="inspector-image-href"
            onChange={(event) =>
              patch<ImageBlock>({ href: event.target.value })
            }
          />
        </InspectorRow>
      )
      rows.push(
        <InspectorRow key="width" label="Width">
          <NumberField
            value={block.width}
            min={16}
            max={1200}
            aria-label="Image width"
            data-testid="inspector-image-width"
            onValueChange={(width) => patch<ImageBlock>({ width })}
          />
        </InspectorRow>,
        <InspectorRow key="padding" label="Padding" align="start">
          <BoxField
            value={block.padding}
            min={0}
            label="Image padding"
            data-testid="inspector-image-padding"
            onValueChange={(padding) => patch<ImageBlock>({ padding })}
          />
        </InspectorRow>
      )
      break
    case "youtube":
      rows.unshift(
        <InspectorRow key="video" label="Video">
          <Input
            value={block.video}
            className="h-control-sm"
            placeholder="youtu.be/…"
            aria-label="YouTube URL"
            data-testid="inspector-youtube-video"
            onChange={(event) =>
              patch<YoutubeBlock>({ video: event.target.value })
            }
          />
        </InspectorRow>
      )
      rows.push(
        <InspectorRow key="width" label="Width">
          <NumberField
            value={block.width}
            min={16}
            max={1200}
            aria-label="Thumbnail width"
            data-testid="inspector-youtube-width"
            onValueChange={(width) => patch<YoutubeBlock>({ width })}
          />
        </InspectorRow>
      )
      break
    case "divider":
      rows.push(
        <InspectorRow key="color" label="Color">
          <ColorField
            value={block.color}
            aria-label="Divider colour"
            data-testid="inspector-divider-color"
            onValueChange={(color) => patch<DividerBlock>({ color })}
          />
        </InspectorRow>,
        <InspectorRow key="thickness" label="Thickness">
          <NumberField
            value={block.thickness}
            min={1}
            max={16}
            aria-label="Divider thickness"
            data-testid="inspector-divider-thickness"
            onValueChange={(thickness) => patch<DividerBlock>({ thickness })}
          />
        </InspectorRow>
      )
      break
    case "spacer":
      rows.push(
        <InspectorRow key="height" label="Height">
          <NumberField
            value={block.height}
            min={1}
            max={200}
            aria-label="Spacer height"
            data-testid="inspector-spacer-height"
            onValueChange={(height) => patch<SpacerBlock>({ height })}
          />
        </InspectorRow>
      )
      break
    case "table":
      rows.push(
        <InspectorRow key="rows" label="Rows" align="start">
          <ParsedTextarea
            text={block.rows.map((row) => row.join(" | ")).join("\n")}
            rows={5}
            className="font-mono text-mono"
            aria-label="Table rows"
            data-testid="inspector-table-rows"
            onTextChange={(text) =>
              patch<TableBlock>({
                rows: text
                  .split("\n")
                  .map((line) => line.split("|").map((cell) => cell.trim())),
              })
            }
          />
        </InspectorRow>,
        <InspectorRow key="header" label="Header row">
          <Switch
            checked={block.headerRow}
            aria-label="Header row"
            data-testid="inspector-table-header"
            onCheckedChange={(headerRow) => patch<TableBlock>({ headerRow })}
          />
        </InspectorRow>,
        <InspectorRow key="border" label="Border color">
          <ColorField
            value={block.borderColor}
            aria-label="Table border colour"
            data-testid="inspector-table-border"
            onValueChange={(borderColor) => patch<TableBlock>({ borderColor })}
          />
        </InspectorRow>
      )
      break
    case "code":
      rows.push(
        <InspectorRow key="code" label="Code" align="start">
          <Textarea
            value={block.code}
            rows={6}
            className="font-mono text-mono"
            aria-label="Code"
            data-testid="inspector-code"
            onChange={(event) => patch<CodeBlock>({ code: event.target.value })}
          />
        </InspectorRow>,
        <InspectorRow key="bg" label="Background">
          <ColorField
            value={block.background}
            aria-label="Code background"
            data-testid="inspector-code-background"
            onValueChange={(background) => patch<CodeBlock>({ background })}
          />
        </InspectorRow>
      )
      break
    case "social":
      rows.push(
        <InspectorRow key="links" label="Links" align="start">
          <ParsedTextarea
            text={block.links
              .map((link) => `${link.label} | ${link.href}`)
              .join("\n")}
            rows={4}
            className="font-mono text-mono"
            aria-label="Social links"
            data-testid="inspector-social-links"
            onTextChange={(text) =>
              patch<SocialBlock>({
                links: text
                  .split("\n")
                  .filter(Boolean)
                  .map((line, index) => {
                    const [label, href] = line.split("|")
                    return {
                      id: `${block.id}_s${index}`,
                      label: (label ?? "").trim(),
                      href: (href ?? "").trim(),
                    }
                  }),
              })
            }
          />
        </InspectorRow>,
        <InspectorRow key="gap" label="Gap">
          <NumberField
            value={block.gap}
            min={0}
            max={64}
            aria-label="Social gap"
            data-testid="inspector-social-gap"
            onValueChange={(gap) => patch<SocialBlock>({ gap })}
          />
        </InspectorRow>
      )
      break
    case "footer":
      rows.unshift(
        <InspectorRow key="label" label="Link label">
          <Input
            value={block.unsubscribeLabel}
            className="h-control-sm"
            aria-label="Unsubscribe label"
            data-testid="inspector-footer-label"
            onChange={(event) =>
              patch<FooterBlock>({ unsubscribeLabel: event.target.value })
            }
          />
        </InspectorRow>
      )
      rows.push(
        <InspectorRow key="color" label="Color">
          <ColorField
            value={block.color ?? doc.theme.text.color}
            aria-label="Footer colour"
            data-testid="inspector-footer-color"
            onValueChange={(color) => patch<FooterBlock>({ color })}
          />
        </InspectorRow>
      )
      break
    case "html":
      rows.push(
        <InspectorRow key="code" label="HTML" align="start">
          <Textarea
            value={block.code}
            rows={8}
            className="font-mono text-mono"
            aria-label="Block HTML"
            data-testid="inspector-html-code"
            onChange={(event) => patch<HtmlBlock>({ code: event.target.value })}
          />
        </InspectorRow>
      )
      break
    case "columns":
      rows.push(
        <InspectorRow key="count" label="Columns">
          <SegmentedToggle
            value={String(block.columns.length)}
            aria-label="Column count"
            testIdPrefix="inspector-columns-count"
            items={COLUMN_COUNTS.map((count) => ({
              value: String(count),
              label: String(count),
            }))}
            onValueChange={(next) =>
              apply((current) =>
                setColumnCount(current, block.id, Number(next) as ColumnCount)
              )
            }
          />
        </InspectorRow>,
        <InspectorRow key="gap" label="Gap">
          <NumberField
            value={block.gap}
            min={0}
            max={64}
            aria-label="Column gap"
            data-testid="inspector-columns-gap"
            onValueChange={(gap) => patch<ColumnsBlock>({ gap })}
          />
        </InspectorRow>,
        <InspectorRow key="bg" label="Background">
          <ColorField
            value={block.background}
            aria-label="Section background"
            data-testid="inspector-columns-background"
            onValueChange={(background) => patch<ColumnsBlock>({ background })}
          />
        </InspectorRow>,
        <InspectorRow key="padding" label="Padding" align="start">
          <BoxField
            value={block.padding}
            min={0}
            label="Section padding"
            data-testid="inspector-columns-padding"
            onValueChange={(padding) => patch<ColumnsBlock>({ padding })}
          />
        </InspectorRow>
      )
      break
  }

  return (
    <>
      <InspectorSection>{rows}</InspectorSection>
      <Separator />
      <InspectorSection title="Advanced">
        <InspectorRow label="CSS class">
          <Input
            value={block.className ?? ""}
            className="h-control-sm"
            placeholder="example"
            aria-label="CSS class"
            data-testid="inspector-class-name"
            onChange={(event) => patch({ className: event.target.value })}
          />
        </InspectorRow>
      </InspectorSection>
    </>
  )
}

/* ------------------------------------------------------------------ panel */

export function Inspector({
  doc,
  apply,
  selectedId,
  select,
  onCollapse,
}: {
  doc: EmailDocument
  apply: Apply
  selectedId: string | null
  select: (id: string | null) => void
  onCollapse: () => void
}) {
  const [panel, setPanel] = React.useState<"page" | "theme" | "css">("page")
  const selected = selectedId ? findBlock(doc, selectedId)?.block : undefined

  if (selected) {
    const entry = blockEntry(selected)
    return (
      <aside
        data-testid="editor-inspector"
        className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background"
      >
        <PanelHeader
          title={entry.label}
          icon={entry.icon}
          closeLabel="Close block properties"
          onClose={() => select(null)}
        />
        <ScrollArea className="min-h-0 flex-1">
          <BlockInspector doc={doc} apply={apply} block={selected} />
          <Separator />
          <div className="p-1.5">
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive"
              data-testid="inspector-delete-block"
              onClick={() => {
                apply((current) => removeBlock(current, selected.id))
                select(null)
              }}
            >
              <Trash2Icon data-icon="inline-start" />
              Delete block
            </Button>
          </div>
        </ScrollArea>
      </aside>
    )
  }

  return (
    <aside
      data-testid="editor-inspector"
      className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background"
    >
      {panel === "page" ? (
        <PanelHeader
          title="Page style"
          icon={FileIcon}
          closeLabel="Collapse panel"
          onClose={onCollapse}
        />
      ) : (
        <PanelHeader
          title={panel === "theme" ? "Theme" : "Global CSS"}
          icon={panel === "theme" ? PaletteIcon : BracesIcon}
          closeLabel="Back to page style"
          onClose={() => setPanel("page")}
        />
      )}
      <ScrollArea className="min-h-0 flex-1">
        {panel === "page" ? (
          <PageStylePanel
            doc={doc}
            apply={apply}
            onOpenTheme={() => setPanel("theme")}
            onOpenCss={() => setPanel("css")}
          />
        ) : panel === "theme" ? (
          <ThemePanel doc={doc} apply={apply} />
        ) : (
          <GlobalCssPanel doc={doc} apply={apply} />
        )}
      </ScrollArea>
    </aside>
  )
}
