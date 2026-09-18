"use client"

import * as React from "react"
import { cn } from "cn"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function isHex(value: string): boolean {
  return HEX.test(value.trim())
}

/* Swatch plus hex field. The swatch is the native colour picker made
   invisible over a tinted tile, so the platform picker still opens and the
   control keeps our own chrome. Non-hex values (`transparent`, a CSS name)
   stay editable as text and show a chequered swatch. */
function ColorField({
  value,
  onValueChange,
  size = "sm",
  className,
  disabled,
  id,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string
  onValueChange: (value: string) => void
  size?: "sm" | "default"
  className?: string
  disabled?: boolean
  id?: string
  "aria-label"?: string
  "data-testid"?: string
}) {
  const [draft, setDraft] = React.useState(value)
  const [synced, setSynced] = React.useState(value)
  if (synced !== value) {
    setSynced(value)
    setDraft(value)
  }
  const valid = isHex(draft)

  return (
    <InputGroup
      data-slot="color-field"
      className={cn(size === "sm" && "h-control-sm", className)}
    >
      <InputGroupAddon className="pl-1.5">
        <span
          className="relative inline-flex size-5 shrink-0 overflow-hidden rounded-[5px] border border-border bg-[repeating-conic-gradient(var(--color-border)_0%_25%,transparent_0%_50%)] bg-[length:8px_8px]"
          style={
            valid
              ? { backgroundColor: draft, backgroundImage: "none" }
              : undefined
          }
        >
          <input
            type="color"
            tabIndex={-1}
            aria-label={ariaLabel ? `${ariaLabel} swatch` : "Pick a colour"}
            value={valid ? draft : "#ffffff"}
            disabled={disabled}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              setDraft(event.target.value)
              onValueChange(event.target.value)
            }}
          />
        </span>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-label={ariaLabel}
        data-testid={testId}
        disabled={disabled}
        className="font-mono text-[13px]"
        onChange={(event) => {
          setDraft(event.target.value)
          if (isHex(event.target.value))
            onValueChange(event.target.value.trim())
        }}
        onBlur={() => {
          const next = draft.trim()
          if (isHex(next) || next === "transparent") {
            onValueChange(next)
            setDraft(next)
            return
          }
          setDraft(value)
        }}
      />
    </InputGroup>
  )
}

export { ColorField, isHex }
