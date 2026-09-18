"use client"

import * as React from "react"
import {
  composeReactEmail,
  isDocumentVisuallyEmpty,
} from "@react-email/editor/core"
import { redoDepth, undoDepth } from "@tiptap/pm/history"
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
  /** The engine. Idle while the broadcast is hand-written HTML. */
  editor: Editor
  mode: BroadcastEditorMode
  /** The email as last exported. Call `flush` first where it must be current:
      the export is too heavy to run on every pause in typing. */
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
  /** Saves and exports whatever is still waiting, right now. */
  flush: () => Promise<void>
}

/* The document is cheap to save, so it goes out soon after typing stops. The
   export renders the whole email and formats it, so it waits for a longer
   lull, or for something that needs it (a send, the HTML view, the review). */
const SAVE_MS = 600
const EXPORT_MS = 2000

/** Editing state for one broadcast: the engine (or the raw markup, for a
    hand-written one) and a debounced write-through to the store. */
export function useBroadcastEditor(item: Broadcast): BroadcastEditorState {
  const { updateBroadcast } = useDashboard()
  const { id, preview } = item
  const [mode, setMode] = React.useState(() => broadcastEditorMode(item))
  const [html, setHtmlState] = React.useState(item.html)
  /* The newest markup, for handlers that run after an awaited export. */
  const htmlRef = React.useRef(html)
  const showHtml = (next: string) => {
    htmlRef.current = next
    setHtmlState(next)
  }
  const [save, setSave] = React.useState<SaveState>("idle")
  /* Read by the engine's update handler, which outlives any one render. The
     engine also updates on its own as it mounts, and while a broadcast is
     hand-written that must not replace the markup with an empty export. */
  const modeRef = React.useRef(mode)
  const changeMode = (next: BroadcastEditorMode) => {
    modeRef.current = next
    setMode(next)
  }

  const timers = React.useRef<{ save?: number; export?: number }>({})
  /* The work still owed to the store. Leaving the editor inside a debounce
     window must not drop it, so unmount flushes whatever is here. */
  const pending = React.useRef<(() => Promise<void>) | null>(null)
  const exports = React.useRef(0)

  const flush = React.useCallback(() => {
    window.clearTimeout(timers.current.save)
    window.clearTimeout(timers.current.export)
    const job = pending.current
    pending.current = null
    return (job ? job() : Promise.resolve()).then(() => setSave("saved"))
  }, [])

  /* Captured once: the engine owns the document from here on, and a new
     object after every save would only make it reconfigure itself. */
  const [initialContent] = React.useState(() => item.content ?? "")
  const editor = useEmailEngine({
    content: initialContent,
    onUpdate: (current) => {
      if (modeRef.current !== "visual") return
      setSave("saving")
      pending.current = async () => {
        const turn = ++exports.current
        const email = await composeReactEmail({
          editor: current,
          preview: preview || undefined,
        })
        /* A newer export, or a switch to hand-written HTML, wins. */
        if (turn !== exports.current || modeRef.current !== "visual") return
        showHtml(email.html)
        updateBroadcast(id, { content: current.getJSON(), html: email.html })
      }
      window.clearTimeout(timers.current.save)
      timers.current.save = window.setTimeout(() => {
        updateBroadcast(id, { content: current.getJSON() })
        setSave("saved")
      }, SAVE_MS)
      window.clearTimeout(timers.current.export)
      timers.current.export = window.setTimeout(() => void flush(), EXPORT_MS)
    },
  })

  React.useEffect(() => () => void flush(), [flush])

  const engine = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      undoable: undoDepth(current.state) > 0,
      redoable: redoDepth(current.state) > 0,
      empty: isDocumentVisuallyEmpty(current.state.doc),
    }),
  })
  const visual = mode === "visual"

  function saveHtml(next: string) {
    showHtml(next)
    setSave("saving")
    pending.current = async () => updateBroadcast(id, { html: next })
    window.clearTimeout(timers.current.save)
    timers.current.save = window.setTimeout(() => void flush(), SAVE_MS)
  }

  return {
    editor,
    mode,
    html,
    empty: visual ? engine.empty : !html.trim(),
    setHtml: saveHtml,
    editAsHtml: () => {
      /* Export first, so the markup handed over is the email on screen. */
      void flush().then(() => {
        changeMode("html")
        updateBroadcast(id, { content: undefined, html: htmlRef.current })
      })
    },
    editVisually: () => {
      changeMode("visual")
      /* Emits an update, which saves and exports the parsed document. */
      editor.commands.setContent(emailContentHtml(html), { emitUpdate: true })
    },
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    undoable: visual && engine.undoable,
    redoable: visual && engine.redoable,
    save,
    flush,
  }
}
