"use client"

import * as React from "react"
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CaseUpperIcon,
  CodeIcon,
  ItalicIcon,
  StrikethroughIcon,
  SuperscriptIcon,
  UnderlineIcon,
  type LucideIcon,
} from "lucide-react"

import { Toggle } from "@/components/ui/toggle"
import {
  SegmentedToggle,
  type SegmentedItem,
} from "@/components/ui/segmented-toggle"
import { cn } from "@/lib/utils"

/* The inspector is a long list of `label → control` rows in titled groups, and
   a handful of single-choice icon toggles. Both live here so every block's
   inspector is assembled from the same pieces. */

export function InspectorSection({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-2 px-3 py-3", className)}>
      {title ? (
        <h3 className="px-0.5 text-caption font-medium text-foreground">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  )
}

export function InspectorRow({
  label,
  htmlFor,
  children,
  align = "center",
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
  align?: "center" | "start"
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2",
        align === "center" ? "items-center" : "items-start"
      )}
    >
      <label
        htmlFor={htmlFor}
        className="truncate pt-px text-sm text-muted-foreground"
      >
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export type EmailAlign = "left" | "center" | "right"

export const ALIGN_ITEMS: (SegmentedItem<EmailAlign> & {
  icon: LucideIcon
})[] = [
  { value: "left", label: "Align left", icon: AlignLeftIcon },
  { value: "center", label: "Align center", icon: AlignCenterIcon },
  { value: "right", label: "Align right", icon: AlignRightIcon },
]

/** The inline marks a run of text can carry, by their engine names. */
export const TEXT_MARKS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: "bold", label: "Bold", icon: BoldIcon },
  { name: "italic", label: "Italic", icon: ItalicIcon },
  { name: "underline", label: "Underline", icon: UnderlineIcon },
  { name: "strike", label: "Strikethrough", icon: StrikethroughIcon },
  { name: "sup", label: "Superscript", icon: SuperscriptIcon },
  { name: "uppercase", label: "Uppercase", icon: CaseUpperIcon },
  { name: "code", label: "Inline code", icon: CodeIcon },
]

/** One toggle per mark; the inspector and the bubble toolbar both show it. */
export function MarkToggles({
  marks = TEXT_MARKS,
  isActive,
  onToggle,
  testIdPrefix,
}: {
  marks?: typeof TEXT_MARKS
  isActive: (name: string) => boolean
  onToggle: (name: string) => void
  testIdPrefix: string
}) {
  return marks.map(({ name, label, icon: Icon }) => (
    <Toggle
      key={name}
      size="sm"
      aria-label={label}
      pressed={isActive(name)}
      data-testid={`${testIdPrefix}${name}`}
      onPressedChange={() => onToggle(name)}
    >
      <Icon />
    </Toggle>
  ))
}

/* The editor's floating pieces (rail, "/" menu, bubble toolbars) sit outside
   a Popover, so they take the popover's look from here. */
export const FLOATING_SURFACE =
  "rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float"

/** One row of an insert menu. */
export const MENU_ROW =
  "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none select-none [&_svg:not([class*='size-'])]:size-4"

export function AlignField({
  value,
  onValueChange,
  testIdPrefix,
}: {
  value: EmailAlign
  onValueChange: (value: EmailAlign) => void
  testIdPrefix?: string
}) {
  return (
    <SegmentedToggle
      value={value}
      onValueChange={onValueChange}
      items={ALIGN_ITEMS}
      aria-label="Alignment"
      testIdPrefix={testIdPrefix}
    />
  )
}
