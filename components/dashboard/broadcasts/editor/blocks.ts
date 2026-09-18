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
import type { Editor, Range } from "@tiptap/core"
import {
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
  MinusIcon,
  MousePointerClickIcon,
  SquareIcon,
  TextQuoteIcon,
  TypeIcon,
  VariableIcon,
} from "lucide-react"

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
  {
    id: "image",
    label: "Image",
    description: "Picture from a URL or an upload",
    icon: ImageIcon,
    keywords: ["image", "picture", "photo", "img"],
    run: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setImage({ src: "https://placehold.co/1072x536/png", alt: "" })
        .run()
    },
  },
]

const COMPONENT_ITEMS: PaletteItem[] = [
  fromEngine("button", MousePointerClickIcon, BUTTON),
  fromEngine("divider", MinusIcon, DIVIDER),
  fromEngine("section", SquareIcon, SECTION),
  fromEngine("columns-2", Columns2Icon, TWO_COLUMNS),
  fromEngine("columns-3", Columns3Icon, THREE_COLUMNS),
  fromEngine("columns-4", Columns4Icon, FOUR_COLUMNS),
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

/** Inserts at the caret, for the rail, which has no "/" text to replace. */
export function insertAtCaret(editor: Editor, item: PaletteItem): void {
  const { from, to } = editor.state.selection
  item.run(editor, { from, to })
}
