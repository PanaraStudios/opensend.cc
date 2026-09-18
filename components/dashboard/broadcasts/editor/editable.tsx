"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/* Inline editing is a `contentEditable` element per block. React never owns its
   children — the effect only writes markup back when the element is not the one
   being typed in — so the caret survives every re-render of the canvas. */

type EditableHandle = {
  element: HTMLElement
  commit: () => void
}

let lastEditable: EditableHandle | null = null
let lastRange: Range | null = null

function rememberSelection(element: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return
  lastRange = range.cloneRange()
}

/** Whether any block editor currently holds the caret. */
export function hasActiveEditable(): boolean {
  return lastEditable !== null
}

function restore(): HTMLElement | null {
  const handle = lastEditable
  if (!handle || !handle.element.isConnected) return null
  handle.element.focus()
  const selection = window.getSelection()
  if (selection && lastRange) {
    selection.removeAllRanges()
    selection.addRange(lastRange)
  }
  return handle.element
}

/** Runs a `document.execCommand` against the block that last had the caret.
    `execCommand` is the only API that edits a contentEditable selection in
    every browser; the result is read straight back out as markup. */
export function runEditableCommand(command: string, value?: string): boolean {
  const element = restore()
  if (!element) return false
  const ok = document.execCommand(command, false, value)
  lastEditable?.commit()
  rememberSelection(element)
  return ok
}

export function insertIntoEditable(text: string): boolean {
  return runEditableCommand("insertText", text)
}

export function InlineEditable({
  html,
  onCommit,
  onEnter,
  onEmptyBackspace,
  onSlash,
  placeholder,
  multiline = true,
  plain = false,
  style,
  className,
  "data-testid": testId,
  "data-editable-for": editableFor,
}: {
  html: string
  onCommit: (html: string) => void
  onEnter?: () => void
  onEmptyBackspace?: () => void
  onSlash?: () => void
  placeholder?: string
  /** Plain-text blocks (a button label) take Enter as "done", not a break. */
  multiline?: boolean
  /** Reads and writes `textContent`, for blocks that store unstyled text. */
  plain?: boolean
  style?: React.CSSProperties
  className?: string
  "data-testid"?: string
  /** Lets `focusBlockEditor` put the caret into this block from anywhere. */
  "data-editable-for"?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  /* `commit` runs from event handlers and from the module-level registry, so
     it reads the newest props out of a ref instead of closing over them. */
  const latest = React.useRef({ html, plain, onCommit })
  React.useEffect(() => {
    latest.current = { html, plain, onCommit }
  })

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    if (document.activeElement === element) return
    if (plain) {
      if (element.textContent !== html) element.textContent = html
      return
    }
    if (element.innerHTML !== html) element.innerHTML = html
  }, [html, plain])

  const commit = React.useCallback(() => {
    const element = ref.current
    if (!element) return
    const current = latest.current
    const next = current.plain ? (element.textContent ?? "") : element.innerHTML
    if (next !== current.html) current.onCommit(next)
  }, [])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      spellCheck
      data-placeholder={placeholder}
      data-testid={testId}
      data-editable-for={editableFor}
      style={style}
      className={cn(
        "outline-none before:pointer-events-none before:text-[#a3a8ad] empty:before:content-[attr(data-placeholder)]",
        className
      )}
      onFocus={() => {
        const element = ref.current
        if (!element) return
        lastEditable = { element, commit: () => commit() }
        rememberSelection(element)
      }}
      onKeyUp={() => {
        if (ref.current) rememberSelection(ref.current)
      }}
      onMouseUp={() => {
        if (ref.current) rememberSelection(ref.current)
      }}
      onBlur={() => {
        commit()
        if (lastEditable?.element === ref.current) lastEditable = null
      }}
      onKeyDown={(event) => {
        const element = ref.current
        if (!element) return
        const meta = event.metaKey || event.ctrlKey
        if (meta && event.key.toLowerCase() === "b") {
          event.preventDefault()
          document.execCommand("bold")
          commit()
          return
        }
        if (meta && event.key.toLowerCase() === "i") {
          event.preventDefault()
          document.execCommand("italic")
          commit()
          return
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          commit()
          onEnter?.()
          return
        }
        if (
          event.key === "Backspace" &&
          onEmptyBackspace &&
          element.textContent === ""
        ) {
          event.preventDefault()
          onEmptyBackspace()
          return
        }
        if (event.key === "/" && onSlash && element.textContent === "") {
          event.preventDefault()
          onSlash()
        }
      }}
    />
  )
}

/** Puts the caret at the end of a block's editable element. */
export function focusBlockEditor(blockId: string) {
  window.requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-editable-for="${blockId}"]`
    )
    if (!element) return
    element.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  })
}
