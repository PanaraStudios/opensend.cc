import { createId } from "./ids"
import type { ContactProperty } from "./types"

/* ------------------------------------------------------------------ model */

export const EMAIL_DOCUMENT_VERSION = 1 as const

export type EmailAlign = "left" | "center" | "right"

/** How the broadcast body is authored. `visual` edits the block tree, `html`
    hands the whole document to the code editor as one raw HTML block. */
export type EmailEditorMode = "visual" | "html"

export type BoxSpacing = {
  top: number
  right: number
  bottom: number
  left: number
}

export type EmailBlockType =
  | "heading"
  | "text"
  | "list"
  | "button"
  | "image"
  | "youtube"
  | "divider"
  | "spacer"
  | "table"
  | "code"
  | "social"
  | "footer"
  | "html"
  | "columns"

type BlockBase = {
  id: string
  /** Optional class, for rules written in the document's global CSS. */
  className?: string
}

export type HeadingLevel = 1 | 2 | 3

export type HeadingBlock = BlockBase & {
  type: "heading"
  text: string
  level: HeadingLevel
  align: EmailAlign
  color?: string
  fontSize?: number
  padding?: BoxSpacing
}

export type TextBlock = BlockBase & {
  type: "text"
  /** Inline markup only: `b`, `i`, `a`, `br`. */
  html: string
  align: EmailAlign
  color?: string
  fontSize?: number
  lineHeight?: number
  padding: BoxSpacing
}

export type ListBlock = BlockBase & {
  type: "list"
  ordered: boolean
  items: string[]
  align: EmailAlign
  color?: string
  fontSize?: number
  padding: BoxSpacing
}

export type ButtonBlock = BlockBase & {
  type: "button"
  label: string
  href: string
  align: EmailAlign
  fullWidth: boolean
  /* Unset means "as the theme's Button says". */
  background?: string
  color?: string
  radius?: number
  fontSize?: number
  padding?: BoxSpacing
}

export type ImageBlock = BlockBase & {
  type: "image"
  src: string
  alt: string
  width: number
  href: string
  align: EmailAlign
  padding: BoxSpacing
}

export type YoutubeBlock = BlockBase & {
  type: "youtube"
  /** Video id, or any YouTube URL; `youtubeVideoId` narrows it. */
  video: string
  alt: string
  width: number
  align: EmailAlign
  padding: BoxSpacing
}

export type DividerBlock = BlockBase & {
  type: "divider"
  color: string
  thickness: number
  padding: BoxSpacing
}

export type SpacerBlock = BlockBase & {
  type: "spacer"
  height: number
}

export type TableBlock = BlockBase & {
  type: "table"
  rows: string[][]
  headerRow: boolean
  borderColor: string
  color?: string
  fontSize?: number
  padding: BoxSpacing
}

export type CodeBlock = BlockBase & {
  type: "code"
  code: string
  /* Unset means "as the theme's Code Block says". */
  background?: string
  radius?: number
  color?: string
  fontSize?: number
  padding?: BoxSpacing
}

export type SocialLink = { id: string; label: string; href: string }

export type SocialBlock = BlockBase & {
  type: "social"
  links: SocialLink[]
  align: EmailAlign
  gap: number
  color?: string
  fontSize?: number
  padding: BoxSpacing
}

export type FooterBlock = BlockBase & {
  type: "footer"
  text: string
  unsubscribeLabel: string
  align: EmailAlign
  color?: string
  fontSize?: number
  padding: BoxSpacing
}

export type HtmlBlock = BlockBase & {
  type: "html"
  code: string
}

export type EmailColumn = {
  id: string
  blocks: EmailLeafBlock[]
}

export type ColumnsBlock = BlockBase & {
  type: "columns"
  gap: number
  background: string
  padding: BoxSpacing
  columns: EmailColumn[]
}

export type EmailLeafBlock =
  | HeadingBlock
  | TextBlock
  | ListBlock
  | ButtonBlock
  | ImageBlock
  | YoutubeBlock
  | DividerBlock
  | SpacerBlock
  | TableBlock
  | CodeBlock
  | SocialBlock
  | FooterBlock
  | HtmlBlock

export type EmailBlock = EmailLeafBlock | ColumnsBlock

/* ------------------------------------------------------------------ theme */

export type ThemeStyleKey =
  | "text"
  | "title"
  | "subtitle"
  | "heading"
  | "list"
  | "nestedList"
  | "listItem"
  | "link"
  | "image"
  | "button"
  | "code"
  | "inlineCode"

export type FontWeight = 400 | 500 | 600 | 700

export type TextDecoration = "none" | "underline" | "line-through"

/* Every group carries every value so one shape serves them all;
   `THEME_STYLE_FIELDS` says which of them a group actually uses. */
export type ThemeStyle = {
  color: string
  fontSize: number
  fontWeight: FontWeight
  /** Percentage, as the theme panel shows it: 155 means `line-height: 1.55`. */
  lineHeight: number
  letterSpacing: number
  decoration: TextDecoration
  padding: BoxSpacing
  background: string
  radius: number
  borderWidth: number
  borderColor: string
}

export type ThemeField = "background" | "text" | "padding" | "radius" | "border"

export type ThemePreset = "minimal" | "basic"

export type EmailTheme = { preset: ThemePreset } & Record<
  ThemeStyleKey,
  ThemeStyle
>

export type EmailPageStyle = {
  background: string
  padding: BoxSpacing
}

export type EmailBodyStyle = {
  align: EmailAlign
  color: string
  background: string
  width: number
  padding: BoxSpacing
  margin: BoxSpacing
  radius: number
  borderWidth: number
  borderColor: string
  fontFamily: string
}

export type EmailDocumentStyle = {
  page: EmailPageStyle
  body: EmailBodyStyle
}

export type EmailDocument = {
  version: typeof EMAIL_DOCUMENT_VERSION
  mode: EmailEditorMode
  style: EmailDocumentStyle
  theme: EmailTheme
  /** Raw CSS emitted into the email's `<head>`. */
  globalCss: string
  blocks: EmailBlock[]
}

/* --------------------------------------------------------------- defaults */

/** Triple-brace variable the renderer swaps for the real opt-out link. */
export const UNSUBSCRIBE_VARIABLE = "{{{OPENSEND_UNSUBSCRIBE_URL}}}"

export const DEFAULT_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export const MONO_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

export function box(
  top: number,
  right = top,
  bottom = top,
  left = right
): BoxSpacing {
  return { top, right, bottom, left }
}

function textStyle(
  color: string,
  fontSize: number,
  fontWeight: FontWeight,
  lineHeight: number,
  padding: BoxSpacing = box(0, 0, 12, 0)
): ThemeStyle {
  return {
    color,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing: 0,
    decoration: "none",
    padding,
    background: "transparent",
    radius: 0,
    borderWidth: 0,
    borderColor: "#000000",
  }
}

/* Two starting points, as the theme panel offers them: "Minimal" is the tight
   system-font scale, "Basic" is roomier with softer ink. */
export function themePreset(preset: ThemePreset): EmailTheme {
  if (preset === "basic") {
    return {
      preset,
      text: textStyle("#1b2023", 16, 400, 165),
      title: textStyle("#0b0d0e", 34, 700, 128, box(0, 0, 16, 0)),
      subtitle: textStyle("#0b0d0e", 26, 600, 136, box(0, 0, 14, 0)),
      heading: textStyle("#0b0d0e", 20, 600, 130, box(0, 0, 12, 0)),
      list: textStyle("#1b2023", 16, 400, 165),
      nestedList: textStyle("#1b2023", 16, 400, 165),
      listItem: textStyle("#1b2023", 16, 400, 165),
      link: {
        ...textStyle("#2563eb", 16, 500, 165, box(0)),
        decoration: "underline",
      },
      image: { ...textStyle("#1b2023", 16, 400, 165), radius: 8 },
      button: {
        ...textStyle("#ffffff", 16, 500, 120, box(14, 24)),
        background: "#0b0d0e",
        radius: 8,
      },
      code: {
        ...textStyle("#1b2023", 14, 400, 150, box(12, 16)),
        background: "#f3f4f6",
        radius: 6,
      },
      inlineCode: {
        ...textStyle("#1e293b", 14, 400, 165, box(0)),
        background: "#e5e7eb",
        radius: 4,
      },
    }
  }
  return {
    preset: "minimal",
    text: textStyle("#000000", 14, 400, 155),
    title: textStyle("#000000", 31, 600, 144, box(0, 0, 16, 0)),
    subtitle: textStyle("#000000", 25, 600, 144, box(0, 0, 12, 0)),
    heading: textStyle("#000000", 19, 600, 108, box(0, 0, 10, 0)),
    list: textStyle("#000000", 14, 400, 155),
    nestedList: textStyle("#000000", 14, 400, 155),
    listItem: textStyle("#000000", 14, 400, 155),
    link: {
      ...textStyle("#000000", 14, 400, 155, box(0)),
      decoration: "underline",
    },
    image: { ...textStyle("#000000", 14, 400, 155), radius: 8 },
    button: {
      ...textStyle("#ffffff", 15, 500, 120, box(12, 20)),
      background: "#000000",
      radius: 8,
    },
    code: {
      ...textStyle("#000000", 13, 400, 150, box(12, 14)),
      background: "#f5f5f5",
      radius: 6,
    },
    inlineCode: {
      ...textStyle("#1e293b", 13, 400, 155, box(0)),
      background: "#e5e7eb",
      radius: 4,
    },
  }
}

export const THEME_STYLE_KEYS: readonly ThemeStyleKey[] = [
  "text",
  "title",
  "subtitle",
  "heading",
  "list",
  "nestedList",
  "listItem",
  "link",
  "image",
  "button",
  "code",
  "inlineCode",
]

export const THEME_STYLE_LABELS: Record<ThemeStyleKey, string> = {
  text: "Text",
  title: "Text / Title",
  subtitle: "Text / Subtitle",
  heading: "Text / Heading",
  list: "Text / List",
  nestedList: "Text / Nested List",
  listItem: "Text / List Item",
  link: "Link",
  image: "Image",
  button: "Button",
  code: "Code Block",
  inlineCode: "Inline Code",
}

const BOXED: readonly ThemeField[] = [
  "background",
  "text",
  "padding",
  "radius",
  "border",
]

/** The values each group exposes in the theme panel and writes to the email. */
export const THEME_STYLE_FIELDS: Record<ThemeStyleKey, readonly ThemeField[]> =
  {
    text: ["text"],
    title: ["text", "padding"],
    subtitle: ["text", "padding"],
    heading: ["text", "padding"],
    list: ["text"],
    nestedList: ["text"],
    listItem: ["text"],
    link: ["text"],
    image: ["radius", "border"],
    button: BOXED,
    code: BOXED,
    inlineCode: ["background", "text", "radius", "border"],
  }

export const FONT_WEIGHTS: { value: FontWeight; label: string }[] = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semi Bold" },
  { value: 700, label: "Bold" },
]

/** Which theme entry a heading level reads from. */
export function headingStyleKey(level: HeadingLevel): ThemeStyleKey {
  if (level === 1) return "title"
  if (level === 2) return "subtitle"
  return "heading"
}

export function defaultDocumentStyle(): EmailDocumentStyle {
  return {
    page: { background: "#f5f5f5", padding: box(24, 12) },
    body: {
      align: "center",
      color: "#000000",
      background: "#ffffff",
      width: 600,
      padding: box(32),
      margin: box(0, 0),
      radius: 8,
      borderWidth: 0,
      borderColor: "#e5e5e5",
      fontFamily: DEFAULT_FONT_FAMILY,
    },
  }
}

function newId(): string {
  return createId("blk")
}

function emptyColumns(id: string, count: number): EmailColumn[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${id}_c${index}`,
    blocks: [] as EmailLeafBlock[],
  }))
}

export function createEmailBlock(
  type: EmailBlockType,
  id: string = newId()
): EmailBlock {
  switch (type) {
    case "heading":
      return { id, type, text: "Heading", level: 3, align: "left" }
    case "text":
      return {
        id,
        type,
        html: "",
        align: "left",
        padding: box(0, 0, 12, 0),
      }
    case "list":
      return {
        id,
        type,
        ordered: false,
        items: ["First item", "Second item"],
        align: "left",
        padding: box(0, 0, 12, 0),
      }
    case "button":
      return {
        id,
        type,
        label: "Read more",
        href: "https://example.com",
        align: "left",
        fullWidth: false,
      }
    case "image":
      return {
        id,
        type,
        src: "https://placehold.co/1072x536/png",
        alt: "",
        width: 536,
        href: "",
        align: "center",
        padding: box(0, 0, 12, 0),
      }
    case "youtube":
      return {
        id,
        type,
        video: "",
        alt: "Watch on YouTube",
        width: 536,
        align: "center",
        padding: box(0, 0, 12, 0),
      }
    case "divider":
      return { id, type, color: "#e5e5e5", thickness: 1, padding: box(8, 0) }
    case "spacer":
      return { id, type, height: 24 }
    case "table":
      return {
        id,
        type,
        rows: [
          ["Item", "Amount"],
          ["Plan", "$20"],
        ],
        headerRow: true,
        borderColor: "#e5e5e5",
        padding: box(0, 0, 12, 0),
      }
    case "code":
      return {
        id,
        type,
        code: "npm install opensend",
      }
    case "social":
      return {
        id,
        type,
        links: [
          { id: `${id}_s0`, label: "X", href: "https://x.com" },
          { id: `${id}_s1`, label: "YouTube", href: "https://youtube.com" },
        ],
        align: "center",
        gap: 12,
        padding: box(8, 0),
      }
    case "footer":
      return {
        id,
        type,
        text: "You are receiving this because you subscribed.",
        unsubscribeLabel: "Unsubscribe",
        align: "center",
        color: "#8a8f94",
        fontSize: 12,
        padding: box(16, 0, 0, 0),
      }
    case "html":
      return { id, type, code: "" }
    case "columns":
      return {
        id,
        type,
        gap: 16,
        background: "transparent",
        padding: box(0),
        columns: emptyColumns(id, 2),
      }
  }
}

export function emptyEmailDocument(): EmailDocument {
  return {
    version: EMAIL_DOCUMENT_VERSION,
    mode: "visual",
    style: defaultDocumentStyle(),
    theme: themePreset("minimal"),
    globalCss: "",
    blocks: [],
  }
}

/** A document whose whole body is one hand-written HTML block. Used for the
    HTML mode, for pasted markup, and to open broadcasts saved before the
    block editor existed. */
export function htmlEmailDocument(
  code: string,
  base: EmailDocument = emptyEmailDocument()
): EmailDocument {
  return {
    ...base,
    mode: "html",
    blocks: [{ ...(createEmailBlock("html") as HtmlBlock), code }],
  }
}

/** The raw markup of an HTML-mode document. */
export function documentRawHtml(doc: EmailDocument): string {
  return doc.blocks
    .map((block) => (block.type === "html" ? block.code : ""))
    .join("")
}

/** The id inside any YouTube URL, or the value itself when it already is one. */
export function youtubeVideoId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const match = trimmed.match(
    /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/
  )
  if (match) return match[1]!
  return /^[A-Za-z0-9_-]{6,}$/.test(trimmed) ? trimmed : ""
}

/* -------------------------------------------------------------- traversal */

export const ROOT_CONTAINER = "root"

/** Where a block sits: the root list, or `blockId:columnIndex`. */
export type ContainerKey = string

export function columnContainerKey(
  blockId: string,
  columnIndex: number
): ContainerKey {
  return `${blockId}:${columnIndex}`
}

export function parseContainerKey(
  key: ContainerKey
): { blockId: string; columnIndex: number } | null {
  if (key === ROOT_CONTAINER) return null
  const at = key.lastIndexOf(":")
  if (at === -1) return null
  const columnIndex = Number(key.slice(at + 1))
  if (!Number.isInteger(columnIndex) || columnIndex < 0) return null
  return { blockId: key.slice(0, at), columnIndex }
}

export function containerBlocks(
  doc: EmailDocument,
  key: ContainerKey
): EmailBlock[] {
  const parsed = parseContainerKey(key)
  if (!parsed) return doc.blocks
  const parent = doc.blocks.find(
    (block): block is ColumnsBlock =>
      block.id === parsed.blockId && block.type === "columns"
  )
  return parent?.columns[parsed.columnIndex]?.blocks ?? []
}

export type BlockLocation = {
  block: EmailBlock
  container: ContainerKey
  index: number
}

export function findBlock(
  doc: EmailDocument,
  blockId: string
): BlockLocation | null {
  const index = doc.blocks.findIndex((block) => block.id === blockId)
  if (index !== -1) {
    return { block: doc.blocks[index]!, container: ROOT_CONTAINER, index }
  }
  for (const block of doc.blocks) {
    if (block.type !== "columns") continue
    for (const [columnIndex, column] of block.columns.entries()) {
      const nested = column.blocks.findIndex((item) => item.id === blockId)
      if (nested !== -1) {
        return {
          block: column.blocks[nested]!,
          container: columnContainerKey(block.id, columnIndex),
          index: nested,
        }
      }
    }
  }
  return null
}

/** Every block in document order, columns before their children. */
export function flattenBlocks(doc: EmailDocument): EmailBlock[] {
  const out: EmailBlock[] = []
  for (const block of doc.blocks) {
    out.push(block)
    if (block.type === "columns") {
      for (const column of block.columns) out.push(...column.blocks)
    }
  }
  return out
}

/* ------------------------------------------------------------- tree edits */

function mapContainer(
  doc: EmailDocument,
  key: ContainerKey,
  map: (blocks: EmailBlock[]) => EmailBlock[]
): EmailDocument {
  const parsed = parseContainerKey(key)
  if (!parsed) return { ...doc, blocks: map(doc.blocks) }
  return {
    ...doc,
    blocks: doc.blocks.map((block) => {
      if (block.id !== parsed.blockId || block.type !== "columns") return block
      return {
        ...block,
        columns: block.columns.map((column, columnIndex) =>
          columnIndex === parsed.columnIndex
            ? {
                ...column,
                blocks: map(column.blocks).filter(
                  (item): item is EmailLeafBlock => item.type !== "columns"
                ),
              }
            : column
        ),
      }
    }),
  }
}

function clampIndex(length: number, index: number): number {
  return Math.max(0, Math.min(length, index))
}

/** Columns never nest, so a columns block can only land in the root list. */
export function canDropIn(type: EmailBlockType, key: ContainerKey): boolean {
  return type !== "columns" || key === ROOT_CONTAINER
}

export function insertBlock(
  doc: EmailDocument,
  block: EmailBlock,
  container: ContainerKey,
  index: number
): EmailDocument {
  if (!canDropIn(block.type, container)) return doc
  return mapContainer(doc, container, (blocks) => {
    const next = [...blocks]
    next.splice(clampIndex(next.length, index), 0, block)
    return next
  })
}

export function removeBlock(
  doc: EmailDocument,
  blockId: string
): EmailDocument {
  const found = findBlock(doc, blockId)
  if (!found) return doc
  return mapContainer(doc, found.container, (blocks) =>
    blocks.filter((block) => block.id !== blockId)
  )
}

export function updateBlock<T extends EmailBlock>(
  doc: EmailDocument,
  blockId: string,
  patch: Partial<T>
): EmailDocument {
  const found = findBlock(doc, blockId)
  if (!found) return doc
  return mapContainer(doc, found.container, (blocks) =>
    blocks.map((block) =>
      block.id === blockId ? ({ ...block, ...patch } as EmailBlock) : block
    )
  )
}

/** Moves a block so it ends up at `index` of `container`, the way dropping it
    there reads on screen. */
export function moveBlock(
  doc: EmailDocument,
  blockId: string,
  container: ContainerKey,
  index: number
): EmailDocument {
  const found = findBlock(doc, blockId)
  if (!found) return doc
  if (!canDropIn(found.block.type, container)) return doc
  if (found.container === container && found.index === index) return doc
  const without = removeBlock(doc, blockId)
  return insertBlock(without, found.block, container, index)
}

/** Keyboard reorder inside the block's own container. */
export function moveBlockBy(
  doc: EmailDocument,
  blockId: string,
  delta: number
): EmailDocument {
  const found = findBlock(doc, blockId)
  if (!found) return doc
  const next = found.index + delta
  if (next < 0 || next >= containerBlocks(doc, found.container).length) {
    return doc
  }
  return moveBlock(doc, blockId, found.container, next)
}

function withFreshIds(block: EmailBlock): EmailBlock {
  const id = newId()
  if (block.type !== "columns") return { ...block, id }
  return {
    ...block,
    id,
    columns: block.columns.map((column, index) => ({
      id: `${id}_c${index}`,
      blocks: column.blocks.map(
        (child) => ({ ...child, id: newId() }) as EmailLeafBlock
      ),
    })),
  }
}

export function duplicateBlock(
  doc: EmailDocument,
  blockId: string
): { doc: EmailDocument; id: string } {
  const found = findBlock(doc, blockId)
  if (!found) return { doc, id: blockId }
  const copy = withFreshIds(found.block)
  return {
    doc: insertBlock(doc, copy, found.container, found.index + 1),
    id: copy.id,
  }
}

export const COLUMN_COUNTS = [1, 2, 3, 4] as const
export type ColumnCount = (typeof COLUMN_COUNTS)[number]

/** Growing adds empty columns; shrinking appends the dropped columns' blocks
    to the last surviving column so nothing is silently lost. */
export function setColumnCount(
  doc: EmailDocument,
  blockId: string,
  count: ColumnCount
): EmailDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((block) => {
      if (block.id !== blockId || block.type !== "columns") return block
      if (count === block.columns.length) return block
      if (count > block.columns.length) {
        const added = emptyColumns(blockId, count).slice(block.columns.length)
        return { ...block, columns: [...block.columns, ...added] }
      }
      const kept = block.columns
        .slice(0, count)
        .map((column) => ({ ...column }))
      const dropped = block.columns.slice(count)
      const last = kept[kept.length - 1]!
      last.blocks = [
        ...last.blocks,
        ...dropped.flatMap((column) => column.blocks),
      ]
      return { ...block, columns: kept }
    }),
  }
}

/** A columns block with `count` columns, for the palette's Section / 2, 3 and
    4 column entries. */
export function createColumnsBlock(count: ColumnCount): ColumnsBlock {
  const block = createEmailBlock("columns") as ColumnsBlock
  return { ...block, columns: emptyColumns(block.id, count) }
}

export function setDocumentStyle(
  doc: EmailDocument,
  patch: {
    page?: Partial<EmailPageStyle>
    body?: Partial<EmailBodyStyle>
  }
): EmailDocument {
  return {
    ...doc,
    style: {
      page: { ...doc.style.page, ...patch.page },
      body: { ...doc.style.body, ...patch.body },
    },
  }
}

export function setThemeStyle(
  doc: EmailDocument,
  key: ThemeStyleKey,
  patch: Partial<ThemeStyle>
): EmailDocument {
  return {
    ...doc,
    theme: { ...doc.theme, [key]: { ...doc.theme[key], ...patch } },
  }
}

/** Puts one theme group back to its preset values. */
export function resetThemeStyle(
  doc: EmailDocument,
  key: ThemeStyleKey
): EmailDocument {
  return {
    ...doc,
    theme: { ...doc.theme, [key]: themePreset(doc.theme.preset)[key] },
  }
}

export function setThemePreset(
  doc: EmailDocument,
  preset: ThemePreset
): EmailDocument {
  return { ...doc, theme: themePreset(preset) }
}

export function isDocumentEmpty(doc: EmailDocument): boolean {
  if (doc.blocks.length === 0) return true
  return doc.blocks.every(
    (block) => block.type === "html" && block.code.trim() === ""
  )
}

/* ---------------------------------------------------------------- history */

export type DocumentHistory = {
  past: EmailDocument[]
  present: EmailDocument
  future: EmailDocument[]
}

const HISTORY_LIMIT = 50

export function createHistory(present: EmailDocument): DocumentHistory {
  return { past: [], present, future: [] }
}

export function pushHistory(
  history: DocumentHistory,
  next: EmailDocument
): DocumentHistory {
  if (next === history.present) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  }
}

export function undoHistory(history: DocumentHistory): DocumentHistory {
  const previous = history.past[history.past.length - 1]
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
  }
}

export function redoHistory(history: DocumentHistory): DocumentHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  }
}

export function canUndo(history: DocumentHistory): boolean {
  return history.past.length > 0
}

export function canRedo(history: DocumentHistory): boolean {
  return history.future.length > 0
}

/* -------------------------------------------------------------- variables */

export type EmailVariable = {
  name: string
  label: string
  fallback: string
  group: "contact" | "system"
}

/* `{{{name}}}` or `{{{name|fallback}}}`. Contact fields are dotted
   (`contact.first_name`); the seeded templates' `{{{FIRST_NAME}}}` style still
   parses, so old copy keeps working. */
const VARIABLE_PATTERN = /\{\{\{\s*([A-Za-z0-9_.]+)\s*(?:\|([^}]*))?\}\}\}/g

export function formatVariable(name: string, fallback = ""): string {
  return fallback ? `{{{${name}|${fallback}}}}` : `{{{${name}}}}`
}

export function parseVariables(
  source: string
): { name: string; fallback: string }[] {
  const out: { name: string; fallback: string }[] = []
  for (const match of source.matchAll(VARIABLE_PATTERN)) {
    out.push({ name: match[1]!, fallback: (match[2] ?? "").trim() })
  }
  return out
}

export const UNSUBSCRIBE_VARIABLE_NAME = "OPENSEND_UNSUBSCRIBE_URL"

export const BUILT_IN_VARIABLES: EmailVariable[] = [
  {
    name: "contact.first_name",
    label: "First name",
    fallback: "there",
    group: "contact",
  },
  {
    name: "contact.last_name",
    label: "Last name",
    fallback: "",
    group: "contact",
  },
  { name: "contact.email", label: "Email", fallback: "", group: "contact" },
  {
    name: UNSUBSCRIBE_VARIABLE_NAME,
    label: "Unsubscribe URL",
    fallback: "",
    group: "system",
  },
]

/** Built-ins plus every contact property defined in the workspace. */
export function availableVariables(
  properties: readonly ContactProperty[]
): EmailVariable[] {
  const seen = new Set(BUILT_IN_VARIABLES.map((variable) => variable.name))
  const extra: EmailVariable[] = []
  for (const property of properties) {
    const name = `contact.${property.key}`
    if (!property.key || seen.has(name)) continue
    seen.add(name)
    extra.push({
      name,
      label: property.name || property.key,
      fallback: property.fallbackValue ?? "",
      group: "contact",
    })
  }
  return [...BUILT_IN_VARIABLES, ...extra]
}

/** Every variable used anywhere in the document, in document order. */
export function documentVariables(doc: EmailDocument): string[] {
  const names = new Set<string>()
  for (const block of flattenBlocks(doc)) {
    const sources: string[] = []
    if (block.type === "text") sources.push(block.html)
    if (block.type === "heading") sources.push(block.text)
    if (block.type === "list") sources.push(...block.items)
    if (block.type === "button") sources.push(block.label, block.href)
    if (block.type === "image") sources.push(block.src, block.alt, block.href)
    if (block.type === "table") sources.push(...block.rows.flat())
    if (block.type === "code") sources.push(block.code)
    if (block.type === "footer") sources.push(block.text)
    if (block.type === "html") sources.push(block.code)
    for (const source of sources) {
      for (const variable of parseVariables(source)) names.add(variable.name)
    }
  }
  return [...names]
}

export function hasUnsubscribeLink(doc: EmailDocument): boolean {
  if (doc.blocks.some((block) => block.type === "footer")) return true
  return documentVariables(doc).includes(UNSUBSCRIBE_VARIABLE_NAME)
}

/* -------------------------------------------------------------- migration */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeTheme(value: unknown): EmailTheme {
  const preset =
    isRecord(value) && value.preset === "basic" ? "basic" : "minimal"
  const defaults = themePreset(preset)
  if (!isRecord(value)) return defaults
  const theme = { ...defaults }
  for (const key of THEME_STYLE_KEYS) {
    const entry = value[key]
    if (isRecord(entry)) {
      theme[key] = { ...defaults[key], ...(entry as Partial<ThemeStyle>) }
    }
  }
  return theme
}

/** Accepts anything persisted as `broadcast.content`; anything unusable falls
    back to the broadcast's stored HTML so old drafts still open. */
export function normalizeEmailDocument(
  content: unknown,
  fallbackHtml: string
): EmailDocument {
  if (
    isRecord(content) &&
    Array.isArray(content.blocks) &&
    isRecord(content.style)
  ) {
    const style = content.style as Partial<EmailDocumentStyle>
    const defaults = defaultDocumentStyle()
    return {
      version: EMAIL_DOCUMENT_VERSION,
      mode: content.mode === "html" ? "html" : "visual",
      style: {
        page: { ...defaults.page, ...style.page },
        body: { ...defaults.body, ...style.body },
      },
      theme: normalizeTheme(content.theme),
      globalCss: typeof content.globalCss === "string" ? content.globalCss : "",
      blocks: content.blocks as EmailBlock[],
    }
  }
  return htmlEmailDocument(fallbackHtml)
}
