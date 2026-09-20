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
  emailEditorMode,
  type EmailEditorMode,
} from "@/lib/dashboard/broadcast"
import { emailContentHtml } from "@/lib/dashboard/email-html"
import type { EmailDraft } from "@/lib/dashboard/types"

export type SaveState = "idle" | "saving" | "saved"

export type EmailEditorState = {
  /** The engine. Idle while the email is hand-written HTML. */
  editor: Editor
  mode: EmailEditorMode
  /** The email as last exported. Call `flush` first where it must be current:
      the export is too heavy to run on every pause in typing. */
  html: string
  /** True while there is nothing to send. */
  empty: boolean
  /** Replaces a hand-written email's markup. */
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
  /** Saves and exports whatever is still waiting, right now. Resolves false
      when that failed: the stored email is then not the one on screen, and a
      caller about to send it, or hand it over, must not go on. */
  flush: () => Promise<boolean>
  /** The email as it stands right now, exported first if it has to be; null
      when the export failed. */
  exportHtml: () => Promise<string | null>
}

/* The document is cheap to save, so it goes out soon after typing stops. The
   export renders the whole email and formats it, so it waits for a longer
   lull, or for something that needs it (a send, the HTML view, the review). */
const SAVE_MS = 600
const EXPORT_MS = 2000

/** What the editor writes back: the document, its export, or both. */
export type EmailEditorPatch = Partial<Pick<EmailDraft, "content" | "html">>

/** Editing state for one email: the engine (or the raw markup, for a
    hand-written one) and a debounced write-through to `onSave`, which stores
    it on whatever record the email belongs to. */
export function useEmailEditor(
  item: EmailDraft,
  onSave: (patch: EmailEditorPatch) => void,
  /** Set when the screen was remounted on another theme preset: the saved
      markup was exported under the old one. */
  exportOnMount = false
): EmailEditorState {
  const { preview } = item
  /* Read through a ref: the debounced work outlives any one render. */
  const onSaveRef = React.useRef(onSave)
  React.useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])
  const [mode, setMode] = React.useState(() => emailEditorMode(item))
  const [html, setHtmlState] = React.useState(item.html)
  /* The newest markup, for handlers that run after an awaited export. */
  const htmlRef = React.useRef(html)
  const showHtml = (next: string) => {
    htmlRef.current = next
    setHtmlState(next)
  }
  const [save, setSave] = React.useState<SaveState>("idle")
  /* Read by the engine's update handler, which outlives any one render. The
     engine also updates on its own as it mounts, and while an email is
     hand-written that must not replace the markup with an empty export. */
  const modeRef = React.useRef(mode)
  const changeMode = (next: EmailEditorMode) => {
    modeRef.current = next
    setMode(next)
  }

  const timers = React.useRef<{ save?: number; export?: number }>({})
  /* The work still owed to the store. Leaving the editor inside a debounce
     window must not drop it, so unmount flushes whatever is here. */
  const pending = React.useRef<(() => Promise<void>) | null>(null)
  /* The export in flight, if any. A flush waits for it: a caller that goes on
     to send, or to hand the markup over, must not do so with the one before. */
  const running = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const busy = React.useRef(0)

  const flush = React.useCallback((): Promise<boolean> => {
    window.clearTimeout(timers.current.save)
    window.clearTimeout(timers.current.export)
    const job = pending.current
    pending.current = null
    /* Nothing owed and nothing in flight: there is no save to report. */
    if (!job && busy.current === 0) return Promise.resolve(true)
    if (job) {
      busy.current++
      /* Jobs run one after another, and this chain never rejects, so a save
         that failed does not take every later one down with it. */
      running.current = running.current
        .then(job)
        .then(
          () => true,
          () => {
            /* Still owed, unless newer work has replaced it: the next flush
               tries again rather than reporting a save that never happened. */
            pending.current ??= job
            return false
          }
        )
        .finally(() => busy.current--)
    }
    return running.current.then((saved) => {
      if (saved) setSave("saved")
      else {
        /* Most likely the browser's storage is full. The work is still in
           the editor, so say so rather than showing a save that never ends. */
        setSave("idle")
        toast.add({
          type: "error",
          title: "Could not save this email",
          description: "Your browser storage may be full.",
        })
      }
      return saved
    })
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
        const email = await composeReactEmail({
          editor: current,
          preview: previewRef.current || undefined,
        })
        /* A switch to hand-written HTML while this ran wins. */
        if (modeRef.current !== "visual") return
        showHtml(email.html)
        onSaveRef.current({ content: current.getJSON(), html: email.html })
      }
      if (saveDocument) {
        window.clearTimeout(timers.current.save)
        timers.current.save = window.setTimeout(() => {
          const current = editorRef.current
          if (!current || current.isDestroyed) return
          try {
            onSaveRef.current({ content: current.getJSON() })
            setSave("saved")
          } catch {
            /* Still owed: the export that follows retries and reports it. */
          }
        }, SAVE_MS)
      }
      window.clearTimeout(timers.current.export)
      timers.current.export = window.setTimeout(() => void flush(), EXPORT_MS)
    },
    [flush]
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
    pending.current = async () => onSaveRef.current({ html: next })
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
      void flush().then((saved) => {
        /* The document is dropped here, so never for markup that is stale. */
        if (!saved) return
        /* Stored before the screen changes: a write that fails must not
           leave hand-written mode on screen over a saved visual document. */
        try {
          onSaveRef.current({ content: undefined, html: htmlRef.current })
        } catch {
          toast.add({
            type: "error",
            title: "Could not save this email",
            description: "Your browser storage may be full.",
          })
          return
        }
        changeMode("html")
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
    exportHtml: () => flush().then((saved) => (saved ? htmlRef.current : null)),
  }
}
