"use client"

import type { LucideIcon } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

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
