"use client"

import * as React from "react"
import { cn } from "cn"
import { Link2Icon, UnlinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NumberField } from "@/components/ui/number-field"

export type BoxValue = {
  top: number
  right: number
  bottom: number
  left: number
}

const SIDES = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
] as const

export function uniformBox(value: BoxValue): boolean {
  return (
    value.top === value.right &&
    value.right === value.bottom &&
    value.bottom === value.left
  )
}

/* One number for all four sides, or four numbers once the sides are unlinked.
   Used for every padding and margin in the email editor. */
function BoxField({
  value,
  onValueChange,
  unit = "px",
  min,
  max,
  className,
  disabled,
  label = "All sides",
  "data-testid": testId,
}: {
  value: BoxValue
  onValueChange: (value: BoxValue) => void
  unit?: string
  min?: number
  max?: number
  className?: string
  disabled?: boolean
  /** Names the single field, and prefixes each side's label when unlinked. */
  label?: string
  "data-testid"?: string
}) {
  const [linked, setLinked] = React.useState(() => uniformBox(value))

  return (
    <div
      data-slot="box-field"
      className={cn("flex min-w-0 items-start gap-1.5", className)}
    >
      {linked ? (
        <NumberField
          value={value.top}
          onValueChange={(next) =>
            onValueChange({ top: next, right: next, bottom: next, left: next })
          }
          unit={unit}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={label}
          data-testid={testId}
        />
      ) : (
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          {SIDES.map((side) => (
            <NumberField
              key={side.key}
              value={value[side.key]}
              onValueChange={(next) =>
                onValueChange({ ...value, [side.key]: next })
              }
              unit={side.label.slice(0, 1)}
              min={min}
              max={max}
              disabled={disabled}
              aria-label={`${label} ${side.label.toLowerCase()}`}
              data-testid={testId ? `${testId}-${side.key}` : undefined}
            />
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={disabled}
        aria-pressed={linked}
        aria-label={linked ? "Unlink sides" : "Link sides"}
        onClick={() => {
          if (linked) {
            setLinked(false)
            return
          }
          setLinked(true)
          onValueChange({
            top: value.top,
            right: value.top,
            bottom: value.top,
            left: value.top,
          })
        }}
      >
        {linked ? <Link2Icon /> : <UnlinkIcon />}
      </Button>
    </div>
  )
}

export { BoxField }
