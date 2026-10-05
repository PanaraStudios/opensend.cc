"use client"

import * as React from "react"
import { Field as FieldPrimitive } from "@base-ui/react/field"
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
      <FieldPrimitive.Control
        render={
          <textarea
            {...props}
            {...(props["aria-label"] && !props["aria-labelledby"]
              ? { "aria-labelledby": undefined }
              : {})}
          />
        }
        id={props.id}
        disabled={props.disabled}
        name={props.name}
        value={props.value}
        defaultValue={props.defaultValue}
        required={props.required}
        readOnly={props.readOnly}
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-[72px] w-full rounded-lg border border-input bg-field px-2.5 py-2 text-base text-foreground shadow-none transition-[border-color,box-shadow] outline-none placeholder:text-faint-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
          className
        )}
      />
    </InputValidation>
  )
}

export { Textarea }
