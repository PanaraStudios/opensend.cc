"use client"

import * as React from "react"
import { stylesToCss, useEmailTheming } from "@react-email/editor/plugins"
import { DragHandle } from "@tiptap/extension-drag-handle-react"
import { EditorContent, type Editor } from "@tiptap/react"
import { GripVerticalIcon } from "lucide-react"

import {
  insertAtCaret,
  insertAtPosition,
  PALETTE_DRAG_TYPE,
  PALETTE_ITEMS,
  type PaletteItem,
} from "@/components/dashboard/broadcasts/editor/blocks"
import { BubbleMenus } from "@/components/dashboard/broadcasts/editor/bubble-menus"
import { EmailHeaderForm } from "@/components/dashboard/broadcasts/editor/header-form"
import { InsertRail } from "@/components/dashboard/broadcasts/editor/palette"
import { SlashMenu } from "@/components/dashboard/broadcasts/editor/slash-menu"
import type { EmailVariable } from "@/lib/dashboard/email-variables"
import type { Broadcast } from "@/lib/dashboard/types"

/* The page, the paper on it, and the engine's document inside the paper. The
   theme's `body` and `container` groups style the first two, so the canvas
   reads like the sent email. */

function themeBox(
  css: Record<string, React.CSSProperties> | null,
  key: "body" | "container"
): React.CSSProperties {
  /* Copied because the engine's style maps have no prototype, which React's
     style handling does not accept. */
  return { ...css?.[key] }
}

export function EmailCanvas({
  item,
  editor,
  sendAt,
  onSendAtChange,
}: {
  item: Broadcast
  editor: Editor
  sendAt: number | null
  onSendAtChange: (value: number | null) => void
}) {
  const theming = useEmailTheming(editor)
  const css = React.useMemo(
    () => (theming ? stylesToCss(theming.styles, theming.theme) : null),
    [theming]
  )

  function insertBlock(entry: PaletteItem) {
    insertAtCaret(editor, entry)
  }

  function insertVariable(variable: EmailVariable) {
    editor
      .chain()
      .focus()
      .insertVariable({ name: variable.name, fallback: variable.fallback })
      .run()
  }

  return (
    <div
      className="relative flex min-h-full justify-center px-3 py-6"
      style={themeBox(css, "body")}
      data-testid="editor-canvas"
    >
      {/* The track spans the whole canvas so the sticky rail inside it holds
          its place while the email scrolls underneath. */}
      <div className="pointer-events-none absolute inset-y-0 left-4 z-30 pt-24 md:left-8">
        <InsertRail
          className="pointer-events-auto sticky top-24"
          onInsertBlock={insertBlock}
          onInsertVariable={insertVariable}
        />
      </div>
      <div
        id="email-paper"
        data-testid="email-paper"
        className="relative max-w-full bg-white text-black"
        style={themeBox(css, "container")}
      >
        <EmailHeaderForm
          item={item}
          sendAt={sendAt}
          onSendAtChange={onSendAtChange}
        />
        {/* The engine paints its editing surface as the page and its container
            node as the paper. Here the canvas and the sheet above already are
            those, so inside the sheet both are flattened. */}
        <DragHandle
          editor={editor}
          className="flex size-6 cursor-grab items-center justify-center rounded-md text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#111827] active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" />
        </DragHandle>
        <EditorContent
          editor={editor}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
              event.preventDefault()
            }
          }}
          onDrop={(event) => {
            const id = event.dataTransfer.getData(PALETTE_DRAG_TYPE)
            const entry = PALETTE_ITEMS.find((one) => one.id === id)
            if (!entry) return
            event.preventDefault()
            const spot = editor.view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })
            if (spot) insertAtPosition(editor, entry, spot.pos)
            else insertAtCaret(editor, entry)
          }}
          className="pt-3 [&_.ProseMirror]:!bg-transparent [&_.ProseMirror]:!p-0 [&_.ProseMirror]:outline-none [&_.node-container]:!w-auto [&_.node-container]:!rounded-none [&_.node-container]:!border-0 [&_.node-container]:!bg-transparent [&_.node-container]:!p-0"
          data-testid="email-content"
        />
        <SlashMenu />
        <BubbleMenus />
      </div>
    </div>
  )
}
