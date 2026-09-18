"use client"

import * as React from "react"

import { broadcastDocument } from "@/lib/dashboard/broadcast"
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type EmailDocument,
} from "@/lib/dashboard/email-document"
import { renderEmailHtml } from "@/lib/dashboard/email-render"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"

export type SaveState = "idle" | "saving" | "saved"

export type BroadcastEditorState = {
  doc: EmailDocument
  /** Applies an edit and pushes it onto the undo stack. */
  apply: (next: EmailDocument | ((doc: EmailDocument) => EmailDocument)) => void
  undo: () => void
  redo: () => void
  undoable: boolean
  redoable: boolean
  selectedId: string | null
  select: (id: string | null) => void
  save: SaveState
}

const AUTOSAVE_MS = 600

/** Document state for one broadcast: an undo stack over the block tree, the
    current selection, and a debounced write-through to the store that also
    refreshes the broadcast's rendered HTML. */
export function useBroadcastEditor(item: Broadcast): BroadcastEditorState {
  const { updateBroadcast } = useDashboard()
  const [history, setHistory] = React.useState(() =>
    createHistory(broadcastDocument(item))
  )
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [save, setSave] = React.useState<SaveState>("idle")
  const dirty = React.useRef(false)
  const doc = history.present
  const { id, preview } = item

  const apply = React.useCallback(
    (next: EmailDocument | ((doc: EmailDocument) => EmailDocument)) => {
      setHistory((current) => {
        const value = typeof next === "function" ? next(current.present) : next
        if (value === current.present) return current
        dirty.current = true
        return pushHistory(current, value)
      })
    },
    []
  )

  const undo = React.useCallback(() => {
    setHistory((current) => {
      if (!canUndo(current)) return current
      dirty.current = true
      return undoHistory(current)
    })
  }, [])

  const redo = React.useCallback(() => {
    setHistory((current) => {
      if (!canRedo(current)) return current
      dirty.current = true
      return redoHistory(current)
    })
  }, [])

  React.useEffect(() => {
    if (!dirty.current) return
    let cancelled = false
    setSave("saving")
    const timer = window.setTimeout(() => {
      void renderEmailHtml(doc, { preview }).then((html) => {
        if (cancelled) return
        updateBroadcast(id, { content: doc, html })
        setSave("saved")
      })
    }, AUTOSAVE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [doc, id, preview, updateBroadcast])

  return {
    doc,
    apply,
    undo,
    redo,
    undoable: canUndo(history),
    redoable: canRedo(history),
    selectedId,
    select: setSelectedId,
    save,
  }
}

/** Live email HTML for the current document, for previews and test sends. */
export function useEmailHtml(doc: EmailDocument, preview: string): string {
  const [html, setHtml] = React.useState("")

  React.useEffect(() => {
    let cancelled = false
    void renderEmailHtml(doc, { preview }).then((next) => {
      if (!cancelled) setHtml(next)
    })
    return () => {
      cancelled = true
    }
  }, [doc, preview])

  return html
}
