import type * as React from "react"
import {
  BULLET_LIST,
  BUTTON,
  CODE,
  DIVIDER,
  FOUR_COLUMNS,
  H1,
  H2,
  H3,
  NUMBERED_LIST,
  QUOTE,
  SECTION,
  TEXT,
  THREE_COLUMNS,
  TWO_COLUMNS,
  type SlashCommandItem,
} from "@react-email/editor/ui"
import type { ChainedCommands, Editor, Range } from "@tiptap/core"
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
  LayoutTemplateIcon,
  ListIcon,
  ListOrderedIcon,
  MailMinusIcon,
  MinusIcon,
  MousePointerClickIcon,
  MoveVerticalIcon,
  PanelBottomIcon,
  PanelTopIcon,
  Share2Icon,
  SquareIcon,
  TextQuoteIcon,
  TypeIcon,
} from "lucide-react"

import { YouTubeIcon } from "@/components/brand-icons"
import {
  FOOTER,
  PATTERNS,
  PLACEHOLDER_IMAGE,
  SOCIAL_LINKS,
} from "@/components/dashboard/broadcasts/editor/patterns"

/* One catalogue of everything that can be inserted. The insert rail and the
   "/" menu both read it, and each entry runs the engine's own command, so the
   two can never drift apart. */

export type PaletteIcon = React.ComponentType<{ className?: string }>

export type PaletteItem = {
  /** Stable id, also the `palette-<id>` and `slash-<id>` test ids. */
  id: string
  label: string
  description: string
  icon: PaletteIcon
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

export type PaletteMenu = {
  id: "text" | "media" | "components" | "sections"
  label: string
  icon: PaletteIcon
  items: readonly PaletteItem[]
}

function fromEngine(
  id: string,
  icon: PaletteIcon,
  command: SlashCommandItem
): PaletteItem {
  return {
    id,
    icon,
    label: command.title,
    description: command.description,
    keywords: command.searchTerms ?? [],
    run: (editor, range) => command.command({ editor, range }),
  }
}

/* An entry of our own: replaces the "/" text, then runs one more command. */
function ours(
  entry: Omit<PaletteItem, "run">,
  insert: (chain: ChainedCommands) => ChainedCommands
): PaletteItem {
  return {
    ...entry,
    run: (editor, range) =>
      insert(editor.chain().focus().deleteRange(range)).run(),
  }
}

const TEXT_ITEMS: PaletteItem[] = [
  fromEngine("text", TypeIcon, TEXT),
  fromEngine("title", Heading1Icon, H1),
  fromEngine("subtitle", Heading2Icon, H2),
  fromEngine("heading", Heading3Icon, H3),
  fromEngine("bullet-list", ListIcon, BULLET_LIST),
  fromEngine("numbered-list", ListOrderedIcon, NUMBERED_LIST),
  fromEngine("quote", TextQuoteIcon, QUOTE),
  fromEngine("code", CodeXmlIcon, CODE),
]

const MEDIA_ITEMS: PaletteItem[] = [
  ours(
    {
      id: "image",
      label: "Image",
      description: "Picture from a URL or an upload",
      icon: ImageIcon,
      keywords: ["image", "picture", "photo", "img"],
    },
    (chain) => chain.setImage({ src: PLACEHOLDER_IMAGE, alt: "" })
  ),
  ours(
    {
      id: "youtube",
      label: "YouTube",
      description: "Video thumbnail that links out",
      icon: YouTubeIcon,
      keywords: ["youtube", "video"],
    },
    (chain) => chain.insertContent({ type: "youtube" })
  ),
]

const COMPONENT_ITEMS: PaletteItem[] = [
  fromEngine("button", MousePointerClickIcon, BUTTON),
  fromEngine("divider", MinusIcon, DIVIDER),
  fromEngine("section", SquareIcon, SECTION),
  fromEngine("columns-2", Columns2Icon, TWO_COLUMNS),
  fromEngine("columns-3", Columns3Icon, THREE_COLUMNS),
  fromEngine("columns-4", Columns4Icon, FOUR_COLUMNS),
  ours(
    {
      id: "spacer",
      label: "Spacer",
      description: "Empty vertical space",
      icon: MoveVerticalIcon,
      keywords: ["spacer", "space", "gap"],
    },
    (chain) => chain.insertContent({ type: "spacer" })
  ),
  ours(
    {
      id: "social",
      label: "Social links",
      description: "A centred row of links",
      icon: Share2Icon,
      keywords: ["social", "links", "twitter", "linkedin", "github"],
    },
    (chain) => chain.insertContent(SOCIAL_LINKS)
  ),
  ours(
    {
      id: "footer",
      label: "Unsubscribe footer",
      description: "Closing note with the opt-out link",
      icon: MailMinusIcon,
      keywords: ["footer", "unsubscribe", "opt out"],
    },
    (chain) => chain.insertContent(FOOTER)
  ),
  ours(
    {
      id: "html",
      label: "HTML",
      description: "Hand-written markup, sent as written",
      icon: BracesIcon,
      keywords: ["html", "code", "raw", "embed"],
    },
    (chain) => chain.insertContent({ type: "html" })
  ),
]

function pattern(
  id: keyof typeof PATTERNS,
  label: string,
  description: string,
  icon: PaletteIcon
): PaletteItem {
  return ours(
    {
      id: `section-${id}`,
      label,
      description,
      icon,
      keywords: [id, "section"],
    },
    (chain) => chain.insertContent(PATTERNS[id])
  )
}

const SECTION_ITEMS: PaletteItem[] = [
  pattern("header", "Header", "Brand line with a row of links", PanelTopIcon),
  pattern("hero", "Hero", "Image, headline, text and a button", ImageIcon),
  pattern("features", "Features", "Two benefits side by side", Columns2Icon),
  pattern(
    "call-to-action",
    "Call to action",
    "A tinted panel with one button",
    MousePointerClickIcon
  ),
  pattern(
    "sign-off",
    "Sign-off",
    "Divider, social links and the unsubscribe footer",
    PanelBottomIcon
  ),
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
  {
    id: "sections",
    label: "Sections",
    icon: LayoutTemplateIcon,
    items: SECTION_ITEMS,
  },
]

export const PALETTE_ITEMS: readonly PaletteItem[] = PALETTE_MENUS.flatMap(
  (menu) => menu.items
)

/** Carries a catalogue id while a rail row is dragged onto the canvas. */
export const PALETTE_DRAG_TYPE = "application/x-opensend-block"

/** Inserts as a new block: at `position` for a row dropped on the canvas,
    else after the selection, for a row clicked in the rail.

    The engine's text commands convert the block the caret is in, which is
    right on the empty "/" line and wrong here, so unless the caret already
    sits on an empty line a fresh one is opened first. It opens after the
    outermost block inside the nearest isolating node (the container, a
    section, a column, a table cell), which is where the schema wants blocks;
    lists and quotes are not isolating, so the line lands after them rather
    than inside. */
export function insertAtCaret(
  editor: Editor,
  item: PaletteItem,
  position?: number
): void {
  if (position !== undefined) editor.commands.setTextSelection(position)
  const { selection } = editor.state
  const { $to } = selection
  const onEmptyLine =
    selection.empty &&
    $to.parent.type.name === "paragraph" &&
    $to.parent.content.size === 0
  if (!onEmptyLine) {
    let host = $to.depth
    while (host > 0 && !$to.node(host).type.spec.isolating) host--
    /* At the host's own depth the selection is a whole block (an image, a
       spacer) and already ends where the new line goes. */
    const after = $to.depth === host ? $to.pos : $to.after(host + 1)
    editor
      .chain()
      .insertContentAt(after, { type: "paragraph" })
      .setTextSelection(after + 1)
      .run()
  }
  const at = editor.state.selection.to
  item.run(editor, { from: at, to: at })
}
