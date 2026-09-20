"use client"

import * as React from "react"
import { cn } from "cn"
import {
  InputValidation,
  type InputValidationProps,
} from "@/components/ui/inline-toast"

function Textarea({
  className,
  validationMessage,
  validationMessages,
  onValidationClear,
  ...props
}: React.ComponentProps<"textarea"> & InputValidationProps) {
  return (
    <InputValidation
      validationMessage={validationMessage}
      validationMessages={validationMessages}
      onValidationClear={onValidationClear}
    >
      <textarea
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-[72px] w-full rounded-lg border border-input bg-field px-2.5 py-2 text-base text-foreground shadow-none transition-[border-color,box-shadow] outline-none placeholder:text-faint-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
          className
        )}
        {...props}
      />
    </InputValidation>
  )
}

export { Textarea }
