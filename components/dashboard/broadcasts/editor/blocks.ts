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
  ListIcon,
  ListOrderedIcon,
  MailMinusIcon,
  MinusIcon,
  MousePointerClickIcon,
  MoveVerticalIcon,
  Share2Icon,
  SquareIcon,
  TextQuoteIcon,
  TypeIcon,
  VariableIcon,
} from "lucide-react"

import { YouTubeIcon } from "@/components/brand-icons"

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
  id: "text" | "media" | "components" | "variables"
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
    (chain) =>
      chain.setImage({ src: "https://placehold.co/1072x536/png", alt: "" })
  ),
  ours(
    {
      id: "youtube",
      label: "YouTube",
      description: "Video thumbnail that links out",
      icon: YouTubeIcon,
      keywords: ["youtube", "video"],
    },
    (chain) => chain.insertYoutube()
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
    (chain) => chain.insertSpacer()
  ),
  ours(
    {
      id: "social",
      label: "Social links",
      description: "A centred row of links",
      icon: Share2Icon,
      keywords: ["social", "links", "twitter", "linkedin", "github"],
    },
    (chain) => chain.insertSocialLinks()
  ),
  ours(
    {
      id: "footer",
      label: "Unsubscribe footer",
      description: "Closing note with the opt-out link",
      icon: MailMinusIcon,
      keywords: ["footer", "unsubscribe", "opt out"],
    },
    (chain) => chain.insertFooter()
  ),
  ours(
    {
      id: "html",
      label: "HTML",
      description: "Hand-written markup, sent as written",
      icon: BracesIcon,
      keywords: ["html", "code", "raw", "embed"],
    },
    (chain) => chain.insertHtml()
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
  { id: "variables", label: "Variables", icon: VariableIcon, items: [] },
]

export const PALETTE_ITEMS: readonly PaletteItem[] = PALETTE_MENUS.flatMap(
  (menu) => menu.items
)

/** Carries a catalogue id while a rail row is dragged onto the canvas. */
export const PALETTE_DRAG_TYPE = "application/x-opensend-block"

/** Inserts at a document position, for a row dropped on the canvas. */
export function insertAtPosition(
  editor: Editor,
  item: PaletteItem,
  position: number
): void {
  editor.commands.setTextSelection(position)
  insertAtCaret(editor, item)
}

/** Inserts after the selection, for the rail, which has no "/" text to
    replace. Collapsing first matters: a block that was just inserted is still
    selected, and the next insert would otherwise overwrite it. */
export function insertAtCaret(editor: Editor, item: PaletteItem): void {
  const { to } = editor.state.selection
  editor.commands.setTextSelection(to)
  const at = editor.state.selection.to
  item.run(editor, { from: at, to: at })
}
