"use client"

import * as React from "react"
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  type LucideIcon,
} from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { EmailAlign } from "@/lib/dashboard/email-document"

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

export type SegmentedItem<T extends string> = {
  value: T
  label: string
  icon?: LucideIcon
}

/** Single-choice toggle group. Base UI models the value as an array, so this
    keeps the array plumbing in one place. */
export function SegmentedToggle<T extends string>({
  value,
  onValueChange,
  items,
  size = "sm",
  orientation = "horizontal",
  className,
  itemClassName,
  "aria-label": ariaLabel,
  testIdPrefix,
}: {
  value: T
  onValueChange: (value: T) => void
  items: readonly SegmentedItem<T>[]
  size?: "sm" | "default"
  orientation?: "horizontal" | "vertical"
  className?: string
  itemClassName?: string
  "aria-label": string
  testIdPrefix?: string
}) {
  return (
    <ToggleGroup
      variant={orientation === "vertical" ? "default" : "outline"}
      size={size}
      spacing={orientation === "vertical" ? 2 : 0}
      orientation={orientation}
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(next) => {
        const selected = next[0] as T | undefined
        if (selected) onValueChange(selected)
      }}
      /* Base UI only writes `data-orientation`, so the stacking is set here
         rather than relying on the group's own vertical variants. */
      className={cn(
        orientation === "vertical"
          ? "flex-col items-stretch"
          : "w-full flex-row",
        className
      )}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <ToggleGroupItem
            key={item.value}
            value={item.value}
            aria-label={item.label}
            title={item.label}
            data-testid={
              testIdPrefix ? `${testIdPrefix}-${item.value}` : undefined
            }
            className={cn(
              orientation === "horizontal" && "flex-1",
              itemClassName
            )}
          >
            {Icon ? <Icon /> : item.label}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

const ALIGN_ITEMS: SegmentedItem<EmailAlign>[] = [
  { value: "left", label: "Align left", icon: AlignLeftIcon },
  { value: "center", label: "Align center", icon: AlignCenterIcon },
  { value: "right", label: "Align right", icon: AlignRightIcon },
]

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
