"use client"

import * as React from "react"
import { ShortcutAction } from "@/lib/dashboard/use-shortcut"
import Link from "next/link"
import { HouseIcon, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SegmentedToggle } from "@/components/ui/segmented-toggle"
import { useDraftValue } from "@/components/dashboard/primitives"
import { sentenceCase } from "@/lib/dashboard/format"

/* The frame of a full-screen editor: a top bar that leads back to the list
   and names the record, and a rail that switches what the screen shows. The
   email editor and the automation builder both sit in it. */

export function EditorTopBar({
  noun,
  listHref,
  listLabel,
  name,
  onRename,
  badge,
  nameReadOnly = false,
  children,
}: {
  /** What the record is called in copy: "broadcast", "automation". */
  noun: string
  listHref: string
  listLabel: string
  name: string
  onRename: (name: string) => void
  badge: React.ReactNode
  /** The name can no longer change, like a template Meta has. */
  nameReadOnly?: boolean
  /** The closing actions: undo, a send, a start. */
  children?: React.ReactNode
}) {
  const { draft, setDraft, commitDraft } = useDraftValue(name, onRename)
  return (
    <header
      data-testid="editor-topbar"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2 sm:h-12 sm:flex-nowrap sm:py-0"
    >
      <h1 className="sr-only">
        {sentenceCase(noun)} editor{name ? `: ${name}` : ""}
      </h1>
      <Button
        variant="ghost"
        size="icon-sm"
        nativeButton={false}
        aria-label={`Back to ${listLabel.toLowerCase()}`}
        data-testid="editor-home"
        render={<Link href={listHref} />}
      >
        <HouseIcon />
      </Button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <Link
          href={listHref}
          className="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:block"
        >
          {listLabel}
        </Link>
        <span className="hidden text-sm text-faint-foreground sm:block">/</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          /* A name cannot be blank. The record would fall back to its own
             default, which the field would not hear about when that is what
             it already holds; so a blanked field goes back to the name. */
          onBlur={() => {
            if (draft.trim()) commitDraft()
            else setDraft(name)
          }}
          aria-label={`${sentenceCase(noun)} name${nameReadOnly ? " (read-only)" : ""}`}
          readOnly={nameReadOnly}
          data-testid="editor-name"
          placeholder="Untitled"
          /* A long name ends in an ellipsis until the field is focused, when
             it scrolls as it is edited; hovering shows the whole of it. */
          title={draft}
          className="max-w-64 min-w-0 truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted"
        />
        {badge}
      </div>
      <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto">
        <ShortcutAction value="save">{children}</ShortcutAction>
      </div>
    </header>
  )
}

export function EditorRail<T extends string>({
  label,
  value,
  items,
  onValueChange,
  testIdPrefix,
}: {
  label: string
  value: T
  items: readonly { value: T; label: string; icon: LucideIcon }[]
  onValueChange: (value: T) => void
  testIdPrefix?: string
}) {
  return (
    <nav
      aria-label={label}
      className="flex w-12 shrink-0 flex-col items-center border-r border-border py-3"
    >
      <SegmentedToggle
        orientation="vertical"
        value={value}
        items={items}
        aria-label={label}
        testIdPrefix={testIdPrefix}
        onValueChange={onValueChange}
        className="w-auto"
      />
    </nav>
  )
}
