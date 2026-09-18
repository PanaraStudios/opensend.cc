"use client"

import * as React from "react"
import { composeReactEmail } from "@react-email/editor/core"
import { useEditorState, type Editor } from "@tiptap/react"

import { useEmailEngine } from "@/components/dashboard/broadcasts/editor/engine"
import {
  broadcastEditorMode,
  type BroadcastEditorMode,
} from "@/lib/dashboard/broadcast"
import { emailContentHtml } from "@/lib/dashboard/email-html"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"

export type SaveState = "idle" | "saving" | "saved"

export type BroadcastEditorState = {
  /** The engine. Null until it mounts, and idle while the broadcast is
      hand-written HTML. */
  editor: Editor | null
  mode: BroadcastEditorMode
  /** The email as it would be sent right now. */
  html: string
  /** True while there is nothing to send. */
  empty: boolean
  /** Replaces a hand-written broadcast's markup. */
  setHtml: (html: string) => void
  /** Hands the current markup over to be edited by hand. One way. */
  editAsHtml: () => void
  /** Reads hand-written markup into the editor, keeping what it understands. */
  editVisually: () => void
  undo: () => void
  redo: () => void
  undoable: boolean
  redoable: boolean
  save: SaveState
  /** Writes any edit still inside the autosave window through right now. */
  flush: () => Promise<void>
}

const AUTOSAVE_MS = 600

/** Editing state for one broadcast: the engine (or the raw markup, for a
    hand-written one) and a debounced write-through to the store that keeps
    the broadcast's exported HTML current. */
export function useBroadcastEditor(item: Broadcast): BroadcastEditorState {
  const { updateBroadcast } = useDashboard()
  const { id, preview } = item
  const [mode, setMode] = React.useState(() => broadcastEditorMode(item))
  const [html, setHtmlState] = React.useState(item.html)
  const [save, setSave] = React.useState<SaveState>("idle")
  /* The newest unsaved edit. Leaving the editor inside the debounce window
     must not drop it, so unmount flushes whatever is still here. */
  const pending = React.useRef<(() => Promise<void>) | null>(null)
  const timer = React.useRef<number | null>(null)

  const flush = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const job = pending.current
    pending.current = null
    return job ? job() : Promise.resolve()
  }, [])

  const schedule = React.useCallback(
    (job: () => Promise<void>) => {
      pending.current = job
      setSave("saving")
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        void flush().then(() => setSave("saved"))
      }, AUTOSAVE_MS)
    },
    [flush]
  )

  const exportEngine = React.useCallback(
    (editor: Editor) =>
      composeReactEmail({ editor, preview: preview || undefined }).then(
        (email) => {
          setHtmlState(email.html)
          updateBroadcast(id, { content: editor.getJSON(), html: email.html })
        }
      ),
    [id, preview, updateBroadcast]
  )

  /* The engine also updates on its own, as it mounts, and while a broadcast
     is hand-written that must not replace the markup with an empty export. */
  const modeRef = React.useRef(mode)
  React.useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const editor = useEmailEngine({
    content: item.content ?? "",
    onUpdate: (current) => {
      if (modeRef.current === "visual") schedule(() => exportEngine(current))
    },
  })

  React.useEffect(() => () => void flush(), [flush])

  const engine = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      undoable: current?.can().undo() ?? false,
      redoable: current?.can().redo() ?? false,
      empty: current?.isEmpty ?? true,
    }),
  })
  const visual = mode === "visual"

  return {
    editor,
    mode,
    html,
    empty: visual ? (engine?.empty ?? true) : !html.trim(),
    setHtml: (next) => {
      setHtmlState(next)
      schedule(async () => updateBroadcast(id, { html: next }))
    },
    editAsHtml: () => {
      setMode("html")
      schedule(async () => updateBroadcast(id, { content: undefined, html }))
    },
    editVisually: () => {
      if (!editor) return
      setMode("visual")
      modeRef.current = "visual"
      /* Emits an update, which exports and saves the parsed document. */
      editor.commands.setContent(emailContentHtml(html), { emitUpdate: true })
    },
    undo: () => editor?.chain().focus().undo().run(),
    redo: () => editor?.chain().focus().redo().run(),
    undoable: visual && (engine?.undoable ?? false),
    redoable: visual && (engine?.redoable ?? false),
    save,
    flush,
  }
}
