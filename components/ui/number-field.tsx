"use client"

import * as React from "react"
import { cn } from "cn"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"

/* Numeric input with a unit suffix. Typing commits as soon as the draft parses
   so a slider-like drag of the value stays live; blur clamps and restores the
   last good value, which keeps a half-typed "-" from writing state. */
function NumberField({
  value,
  onValueChange,
  unit = "px",
  min,
  max,
  step = 1,
  placeholder,
  size = "sm",
  className,
  disabled,
  id,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  /** `null` renders the placeholder, for values that may be automatic. */
  value: number | null
  onValueChange: (value: number) => void
  unit?: string
  min?: number
  max?: number
  step?: number
  placeholder?: string
  size?: "sm" | "default"
  className?: string
  disabled?: boolean
  id?: string
  "aria-label"?: string
  "data-testid"?: string
}) {
  const text = value === null ? "" : String(value)
  const [draft, setDraft] = React.useState(text)
  const [synced, setSynced] = React.useState(text)
  if (synced !== text) {
    setSynced(text)
    setDraft(text)
  }

  function clamp(next: number): number {
    if (min !== undefined && next < min) return min
    if (max !== undefined && next > max) return max
    return next
  }

  function commit(next: string) {
    setDraft(next)
    const parsed = Number(next)
    if (next.trim() !== "" && Number.isFinite(parsed)) {
      onValueChange(clamp(parsed))
    }
  }

  return (
    <InputGroup
      data-slot="number-field"
      className={cn(size === "sm" && "h-control-sm", className)}
    >
      <InputGroupInput
        id={id}
        type="number"
        inputMode="numeric"
        step={step}
        min={min}
        max={max}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        disabled={disabled}
        className="[appearance:textfield] tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={(event) => commit(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft)
          if (draft.trim() === "" || !Number.isFinite(parsed)) {
            setDraft(text)
            return
          }
          const clamped = clamp(parsed)
          setDraft(String(clamped))
          onValueChange(clamped)
        }}
      />
      {unit ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-caption">{unit}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

export { NumberField }
