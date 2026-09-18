"use client"

import * as React from "react"

import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/* Monospace editor with a line-number gutter. Used by the HTML code mode and
   by the Global CSS panel, so both look and scroll the same. */
export function CodeEditor({
  value,
  onValueChange,
  placeholder,
  readOnly = false,
  className,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  "aria-label": string
  "data-testid"?: string
}) {
  const gutter = React.useRef<HTMLDivElement>(null)
  const lines = Math.max(1, value.split("\n").length)

  return (
    <div
      className={cn(
        "relative flex min-h-0 overflow-hidden rounded-xl border border-border bg-muted/30 font-mono text-mono",
        className
      )}
    >
      <div
        ref={gutter}
        aria-hidden="true"
        className="shrink-0 overflow-hidden border-r border-border bg-muted/40 py-2 text-right text-faint-foreground tabular-nums select-none"
      >
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="px-2 leading-6">
            {index + 1}
          </div>
        ))}
      </div>
      <Textarea
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-3 py-2 font-mono text-mono leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
        onChange={(event) => onValueChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) {
            gutter.current.scrollTop = event.currentTarget.scrollTop
          }
        }}
      />
    </div>
  )
}
