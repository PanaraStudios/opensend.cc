import type * as React from "react"
import {
  BracesIcon,
  CodeXmlIcon,
  Columns2Icon,
  Columns3Icon,
  Columns4Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  MailMinusIcon,
  MinusIcon,
  MousePointerClickIcon,
  MoveVerticalIcon,
  Share2Icon,
  SquareIcon,
  TableIcon,
  TypeIcon,
  VariableIcon,
} from "lucide-react"

import { YouTubeIcon } from "@/components/brand-icons"
import {
  createColumnsBlock,
  createEmailBlock,
  type EmailBlock,
  type EmailBlockType,
  type HeadingBlock,
  type ListBlock,
} from "@/lib/dashboard/email-document"

export type PaletteIcon = React.ComponentType<{ className?: string }>

export type PaletteItem = {
  /** Stable id, also the `palette-<id>` test id and the drag id. */
  id: string
  label: string
  description: string
  icon: PaletteIcon
  type: EmailBlockType
  keywords: string
  create: () => EmailBlock
}

export type PaletteMenu = {
  id: "text" | "media" | "components" | "variables"
  label: string
  icon: PaletteIcon
  items: readonly PaletteItem[]
}

function heading(level: 1 | 2 | 3): EmailBlock {
  return { ...(createEmailBlock("heading") as HeadingBlock), level }
}

function list(ordered: boolean): EmailBlock {
  return { ...(createEmailBlock("list") as ListBlock), ordered }
}

/* One catalogue behind the insert rail, the flyout menus and the slash menu,
   so a new block type is described in exactly one place. */

const TEXT_ITEMS: readonly PaletteItem[] = [
  {
    id: "text",
    label: "Text",
    description: "A paragraph of copy",
    icon: TypeIcon,
    type: "text",
    keywords: "paragraph copy body",
    create: () => createEmailBlock("text"),
  },
  {
    id: "title",
    label: "Title",
    description: "The largest heading",
    icon: Heading1Icon,
    type: "heading",
    keywords: "h1 headline",
    create: () => heading(1),
  },
  {
    id: "subtitle",
    label: "Subtitle",
    description: "A secondary heading",
    icon: Heading2Icon,
    type: "heading",
    keywords: "h2",
    create: () => heading(2),
  },
  {
    id: "heading",
    label: "Heading",
    description: "A small section title",
    icon: Heading3Icon,
    type: "heading",
    keywords: "h3",
    create: () => heading(3),
  },
  {
    id: "bullet-list",
    label: "Bullet list",
    description: "An unordered list",
    icon: ListIcon,
    type: "list",
    keywords: "ul bullets points",
    create: () => list(false),
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    description: "An ordered list",
    icon: ListOrderedIcon,
    type: "list",
    keywords: "ol steps numbers",
    create: () => list(true),
  },
]

const MEDIA_ITEMS: readonly PaletteItem[] = [
  {
    id: "image",
    label: "Image",
    description: "A picture, optionally linked",
    icon: ImageIcon,
    type: "image",
    keywords: "picture photo img",
    create: () => createEmailBlock("image"),
  },
  {
    id: "youtube",
    label: "YouTube",
    description: "A linked video thumbnail",
    icon: YouTubeIcon,
    type: "youtube",
    keywords: "video embed",
    create: () => createEmailBlock("youtube"),
  },
]

const COMPONENT_ITEMS: readonly PaletteItem[] = [
  {
    id: "button",
    label: "Button",
    description: "A call to action",
    icon: MousePointerClickIcon,
    type: "button",
    keywords: "cta link action",
    create: () => createEmailBlock("button"),
  },
  {
    id: "divider",
    label: "Divider",
    description: "A horizontal rule",
    icon: MinusIcon,
    type: "divider",
    keywords: "rule hr line separator",
    create: () => createEmailBlock("divider"),
  },
  {
    id: "spacer",
    label: "Spacer",
    description: "Vertical breathing room",
    icon: MoveVerticalIcon,
    type: "spacer",
    keywords: "gap space margin",
    create: () => createEmailBlock("spacer"),
  },
  {
    id: "section",
    label: "Section",
    description: "One container that holds blocks",
    icon: SquareIcon,
    type: "columns",
    keywords: "container group panel",
    create: () => createColumnsBlock(1),
  },
  {
    id: "columns-2",
    label: "2 columns",
    description: "Two side-by-side columns",
    icon: Columns2Icon,
    type: "columns",
    keywords: "grid row split",
    create: () => createColumnsBlock(2),
  },
  {
    id: "columns-3",
    label: "3 columns",
    description: "Three side-by-side columns",
    icon: Columns3Icon,
    type: "columns",
    keywords: "grid row split",
    create: () => createColumnsBlock(3),
  },
  {
    id: "columns-4",
    label: "4 columns",
    description: "Four side-by-side columns",
    icon: Columns4Icon,
    type: "columns",
    keywords: "grid row split",
    create: () => createColumnsBlock(4),
  },
  {
    id: "table",
    label: "Table",
    description: "Rows and columns of text",
    icon: TableIcon,
    type: "table",
    keywords: "grid rows cells",
    create: () => createEmailBlock("table"),
  },
  {
    id: "social",
    label: "Social links",
    description: "A row of profile links",
    icon: Share2Icon,
    type: "social",
    keywords: "share profiles follow",
    create: () => createEmailBlock("social"),
  },
  {
    id: "footer",
    label: "Unsubscribe footer",
    description: "Small print and opt-out link",
    icon: MailMinusIcon,
    type: "footer",
    keywords: "unsubscribe legal small print",
    create: () => createEmailBlock("footer"),
  },
  {
    id: "html",
    label: "HTML",
    description: "Hand-written markup",
    icon: CodeXmlIcon,
    type: "html",
    keywords: "code markup embed raw",
    create: () => createEmailBlock("html"),
  },
  {
    id: "code",
    label: "Code",
    description: "A preformatted code block",
    icon: BracesIcon,
    type: "code",
    keywords: "pre snippet monospace",
    create: () => createEmailBlock("code"),
  },
]

export const PALETTE_MENUS: readonly PaletteMenu[] = [
  { id: "text", label: "Text", icon: TypeIcon, items: TEXT_ITEMS },
  { id: "media", label: "Media", icon: ImageIcon, items: MEDIA_ITEMS },
  {
    id: "components",
    label: "Components",
    icon: Columns2Icon,
    items: COMPONENT_ITEMS,
  },
  { id: "variables", label: "Variables", icon: VariableIcon, items: [] },
]

export const PALETTE_ITEMS: readonly PaletteItem[] = [
  ...TEXT_ITEMS,
  ...MEDIA_ITEMS,
  ...COMPONENT_ITEMS,
]

export function paletteItem(id: string): PaletteItem | undefined {
  return PALETTE_ITEMS.find((item) => item.id === id)
}

/** The palette entry that best describes an existing block, for toolbars and
    the inspector title. */
export function blockEntry(block: {
  type: EmailBlockType
  level?: number
  ordered?: boolean
  columns?: unknown[]
}): PaletteItem {
  if (block.type === "heading") {
    const id =
      block.level === 1 ? "title" : block.level === 2 ? "subtitle" : "heading"
    return paletteItem(id)!
  }
  if (block.type === "list") {
    return paletteItem(block.ordered ? "numbered-list" : "bullet-list")!
  }
  if (block.type === "columns") {
    const count = block.columns?.length ?? 2
    return (
      paletteItem(count === 1 ? "section" : `columns-${count}`) ??
      paletteItem("columns-2")!
    )
  }
  return (
    PALETTE_ITEMS.find((item) => item.type === block.type) ?? PALETTE_ITEMS[0]!
  )
}
