"use client"

import * as React from "react"

import type {
  ContainerKey,
  EmailBlock,
  EmailTheme,
} from "@/lib/dashboard/email-document"

/** What a canvas block can do to the document. Passed through context so a
    block nested in a column reaches the same actions as a root one. */
export type CanvasActions = {
  theme: EmailTheme
  selectedId: string | null
  select: (id: string | null) => void
  update: <T extends EmailBlock>(id: string, patch: Partial<T>) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  moveBy: (id: string, delta: number) => void
  /** Adds a block straight after `id` and focuses it. */
  insertAfter: (id: string, block: EmailBlock) => void
  /** Swaps the block for `block`, keeping its position. */
  replace: (id: string, block: EmailBlock) => void
  /** Renders a sortable, droppable list for a column. Owned by the canvas. */
  renderContainer: (
    container: ContainerKey,
    blocks: readonly EmailBlock[]
  ) => React.ReactNode
}

const CanvasActionsContext = React.createContext<CanvasActions | null>(null)

export const CanvasActionsProvider = CanvasActionsContext.Provider

export function useCanvasActions(): CanvasActions {
  const actions = React.useContext(CanvasActionsContext)
  if (!actions) {
    throw new Error("useCanvasActions must be used inside the broadcast canvas")
  }
  return actions
}
