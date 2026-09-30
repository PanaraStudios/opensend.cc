"use client"

import * as React from "react"
import { isVisible, useShortcut } from "./use-shortcut"

/** Work on rendered rows only: selection and navigation cannot reach another page. */
export function useTableShortcuts() {
  const table = React.useRef<HTMLDivElement>(null)
  const highlighted = React.useRef<HTMLElement | null>(null)
  const rows = () =>
    Array.from(
      table.current?.querySelectorAll<HTMLElement>("tbody tr") ?? []
    ).filter(isVisible)
  const clear = () => {
    highlighted.current?.removeAttribute("data-keyboard-highlight")
    highlighted.current = null
  }
  const current = () => {
    const row = highlighted.current
    return row && rows().includes(row) ? row : null
  }
  const move = (direction: number) => {
    const visible = rows()
    if (!visible.length) return false
    const index = visible.indexOf(current()!)
    const next =
      visible[
        index < 0
          ? direction > 0
            ? 0
            : visible.length - 1
          : Math.max(0, Math.min(visible.length - 1, index + direction))
      ]
    clear()
    highlighted.current = next
    next.setAttribute("data-keyboard-highlight", "true")
    next.tabIndex = -1
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: "nearest" })
  }
  useShortcut("j", () => move(1))
  useShortcut("k", () => move(-1))
  useShortcut("Enter", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, [role="button"], [role="checkbox"]')
    )
      return false
    const link = current()?.querySelector<HTMLElement>(
      'a[href], [data-row-open], [aria-haspopup="menu"]'
    )
    if (!link) return false
    link.click()
  })
  useShortcut("x", () => {
    const checkbox = current()?.querySelector<HTMLElement>(
      '[role="checkbox"]:not([disabled]):not([aria-disabled="true"])'
    )
    if (!checkbox) return false
    checkbox.click()
  })
  useShortcut("mod+a", () => {
    const checkbox = table.current?.querySelector<HTMLElement>(
      'thead [role="checkbox"]:not([disabled]):not([aria-disabled="true"])'
    )
    if (!checkbox || !rows().length) return false
    if (checkbox.getAttribute("aria-checked") !== "true") checkbox.click()
  })
  useShortcut(
    "Escape",
    () => {
      const hadHighlight = !!current()
      clear()
      const clearSelection = document.querySelector<HTMLElement>(
        '[aria-label="Bulk actions"] [aria-label="Clear selection"]'
      )
      if (clearSelection) clearSelection.click()
      return hadHighlight || !!clearSelection ? undefined : false
    },
    { priority: 30 }
  )
  React.useEffect(() => {
    const root = table.current
    if (!root) return
    const observer = new MutationObserver(() => {
      if (highlighted.current && !root.contains(highlighted.current)) clear()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      clear()
    }
  }, [])
  return table
}
