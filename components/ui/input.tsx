"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"
import {
  InputValidation,
  type InputValidationProps,
} from "@/components/ui/inline-toast"

/* Input: surface fill, 1px border, 8px radius, 36px tall, 14px text.
   Focus swaps the border to accent and adds a soft 2px accent ring. */
function Input({
  className,
  type,
  validationMessage,
  validationMessages,
  onValidationClear,
  ...props
}: React.ComponentProps<"input"> & InputValidationProps) {
  return (
    <InputValidation
      validationMessage={validationMessage}
      validationMessages={validationMessages}
      onValidationClear={onValidationClear}
    >
      <InputPrimitive
        type={type}
        data-slot="input"
        className={cn(
          "h-control w-full min-w-0 rounded-lg border border-input bg-field px-2.5 py-1 text-base text-foreground shadow-none transition-[border-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-faint-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
          className
        )}
        {...props}
      />
    </InputValidation>
  )
}

export { Input }
