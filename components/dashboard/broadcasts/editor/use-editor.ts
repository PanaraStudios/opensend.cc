"use client"

import * as React from "react"
import {
  composeReactEmail,
  isDocumentVisuallyEmpty,
} from "@react-email/editor/core"
import { redoDepth, undoDepth } from "@tiptap/pm/history"
import { useEditorState, type Editor } from "@tiptap/react"

import { toast } from "@/components/ui/toast"
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
  /** The email as it stands right now, exported first if it has to be. */
  exportHtml: () => Promise<string>
}

/* The document is cheap to save, so it goes out soon after typing stops. The
   export renders the whole email and formats it, so it waits for a longer
   lull, or for something that needs it (a send, the HTML view, the review). */
const SAVE_MS = 600
const EXPORT_MS = 2000

/** Editing state for one broadcast: the engine (or the raw markup, for a
    hand-written one) and a debounced write-through to the store. */
export function useBroadcastEditor(
  item: Broadcast,
  /** Set when the screen was remounted on another theme preset: the saved
      markup was exported under the old one. */
  exportOnMount = false
): BroadcastEditorState {
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
  /* The export in flight, if any. A flush waits for it: a caller that goes on
     to send, or to hand the markup over, must not do so with the one before. */
  const running = React.useRef<Promise<void>>(Promise.resolve())
  const busy = React.useRef(false)
  const exports = React.useRef(0)

  const flush = React.useCallback(() => {
    window.clearTimeout(timers.current.save)
    window.clearTimeout(timers.current.export)
    const job = pending.current
    pending.current = null
    /* Nothing owed and nothing in flight: there is no save to report. */
    if (!job && !busy.current) return running.current
    if (job) {
      busy.current = true
      /* A save that failed must not take every later one down with it. */
      running.current = running.current
        .catch(() => {})
        .then(job)
        .finally(() => (busy.current = false))
    }
    return running.current.then(
      () => setSave("saved"),
      () => {
        /* Most likely the browser's storage is full. The work is still in
           the editor, so say so rather than showing a save that never ends. */
        setSave("idle")
        toast.add({
          type: "error",
          title: "Could not save this broadcast",
          description: "Your browser storage may be full.",
        })
      }
    )
  }, [])

  /* Read through refs: the engine keeps the handler it was created with. */
  const previewRef = React.useRef(preview)
  const editorRef = React.useRef<Editor | null>(null)

  /* Owes the store a fresh export, soon; and the document, sooner. */
  const requestExport = React.useCallback(
    (saveDocument: boolean) => {
      if (!editorRef.current || modeRef.current !== "visual") return
      setSave("saving")
      /* The engine is looked up when the work runs, not when it is owed: a
         change of theme preset replaces it in between. */
      pending.current = async () => {
        const current = editorRef.current
        if (!current || current.isDestroyed) return
        const turn = ++exports.current
        const email = await composeReactEmail({
          editor: current,
          preview: previewRef.current || undefined,
        })
        /* A newer export, or a switch to hand-written HTML, wins. */
        if (turn !== exports.current || modeRef.current !== "visual") return
        showHtml(email.html)
        updateBroadcast(id, { content: current.getJSON(), html: email.html })
      }
      if (saveDocument) {
        window.clearTimeout(timers.current.save)
        timers.current.save = window.setTimeout(() => {
          const current = editorRef.current
          if (!current || current.isDestroyed) return
          updateBroadcast(id, { content: current.getJSON() })
          setSave("saved")
        }, SAVE_MS)
      }
      window.clearTimeout(timers.current.export)
      timers.current.export = window.setTimeout(() => void flush(), EXPORT_MS)
    },
    [flush, id, updateBroadcast]
  )

  /* Captured once: the engine owns the document from here on, and a new
     object after every save would only make it reconfigure itself. Anything
     that is not an engine document (a draft from the block editor that came
     before it) is left out; its exported markup is what opens. */
  const [initialContent] = React.useState(() =>
    item.content?.type === "doc" ? item.content : ""
  )
  /* The engine edits the document itself as it mounts (it wraps the content
     in its container and seeds the theme). That is not the author's doing, so
     it is not saved: opening a draft must not mark it as edited. */
  const settled = React.useRef(false)
  const editor = useEmailEngine({
    content: initialContent,
    onUpdate: () => {
      if (settled.current) requestExport(true)
    },
  })
  React.useEffect(() => {
    editorRef.current = editor
    const frame = window.requestAnimationFrame(() => {
      settled.current = true
      if (exportOnMount) requestExport(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editor, exportOnMount, requestExport])

  /* The inbox preview is part of the export, so editing it owes a new one. */
  React.useEffect(() => {
    if (previewRef.current === preview) return
    previewRef.current = preview
    requestExport(false)
  }, [preview, requestExport])

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
      settled.current = true
      /* Emits an update, which saves and exports the parsed document. */
      editor.commands.setContent(emailContentHtml(html), { emitUpdate: true })
    },
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    undoable: visual && engine.undoable,
    redoable: visual && engine.redoable,
    save,
    flush,
    exportHtml: () => flush().then(() => htmlRef.current),
  }
}
