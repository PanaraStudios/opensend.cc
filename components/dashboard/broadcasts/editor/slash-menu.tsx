"use client"

import * as React from "react"
import { SlashCommand, type SlashCommandItem } from "@react-email/editor/ui"

import { PALETTE_ITEMS } from "@/components/dashboard/broadcasts/editor/blocks"
import { cn } from "@/lib/utils"

/* Typing "/" opens the catalogue at the caret. The engine owns the trigger,
   the filtering, the position and the arrow keys; this only draws the rows. */

const ITEMS: SlashCommandItem[] = PALETTE_ITEMS.map((item) => ({
  title: item.label,
  description: item.description,
  searchTerms: item.keywords,
  category: item.id,
  icon: null,
  command: ({ editor, range }) => item.run(editor, range),
}))

export function SlashMenu() {
  return (
    <SlashCommand items={ITEMS}>
      {({ items, selectedIndex, onSelect }) => (
        <div
          role="listbox"
          aria-label="Insert"
          data-testid="slash-menu"
          className="flex max-h-72 w-64 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float"
        >
          {items.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No blocks found.
            </p>
          ) : null}
          {items.map((item, index) => {
            const entry = PALETTE_ITEMS.find((one) => one.id === item.category)
            const Icon = entry?.icon
            return (
              <button
                key={item.category}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                data-testid={`slash-${item.category}`}
                ref={
                  index === selectedIndex
                    ? (node) => node?.scrollIntoView({ block: "nearest" })
                    : undefined
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none select-none",
                  index === selectedIndex && "bg-accent text-accent-foreground"
                )}
                /* Keeps the caret in the editor, so the command has a range. */
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(index)}
              >
                {Icon ? (
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </button>
            )
          })}
        </div>
      )}
    </SlashCommand>
  )
}
