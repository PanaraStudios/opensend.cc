"use client"

import * as React from "react"
import { SlashCommand, type SlashCommandItem } from "@react-email/editor/ui"

import { PALETTE_ITEMS } from "@/components/dashboard/broadcasts/editor/blocks"
import {
  FLOATING_SURFACE,
  MENU_ROW,
} from "@/components/dashboard/broadcasts/editor/controls"
import { cn } from "@/lib/utils"

/* Typing "/" opens the catalogue at the caret. The engine owns the trigger,
   the filtering, the position and the arrow keys; this only draws the rows. */

const ITEMS: SlashCommandItem[] = PALETTE_ITEMS.map((item) => ({
  title: item.label,
  description: item.description,
  searchTerms: item.keywords,
  category: item.id,
  icon: <item.icon className="size-4 shrink-0 text-muted-foreground" />,
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
          className={cn(
            "flex max-h-72 w-64 flex-col gap-0.5 overflow-y-auto",
            FLOATING_SURFACE
          )}
        >
          {items.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No blocks found.
            </p>
          ) : null}
          {items.map((item, index) => (
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
                MENU_ROW,
                index === selectedIndex && "bg-accent text-accent-foreground"
              )}
              /* Keeps the caret in the editor, so the command has a range. */
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(index)}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </SlashCommand>
  )
}
