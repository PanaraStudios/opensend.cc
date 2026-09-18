"use client"

import * as React from "react"
import Link from "next/link"
import { HouseIcon, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SegmentedToggle } from "@/components/ui/segmented-toggle"
import { useDraft } from "@/components/dashboard/primitives"
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
  children,
}: {
  /** What the record is called in copy: "broadcast", "automation". */
  noun: string
  listHref: string
  listLabel: string
  name: string
  onRename: (name: string) => void
  badge: React.ReactNode
  /** The closing actions: undo, a send, a start. */
  children?: React.ReactNode
}) {
  const draft = useDraft(name, onRename)
  return (
    <header
      data-testid="editor-topbar"
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2"
    >
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
          {...draft}
          aria-label={`${sentenceCase(noun)} name`}
          data-testid="editor-name"
          placeholder="Untitled"
          className="max-w-64 min-w-0 rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted"
        />
        {badge}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
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
