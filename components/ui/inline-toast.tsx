"use client"

import {
  Children,
  cloneElement,
  createContext,
  useContext,
  useEffect,
  isValidElement,
  useId,
  useState,
  type ComponentProps,
  type FormEvent,
  type FocusEvent,
  type InvalidEvent,
  type ReactElement,
  type ReactNode,
} from "react"
import { cn } from "cn"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/* Status marks sit inside TooltipContent, sized by the icon slot. */
const iconByVariant = {
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  default: InfoIcon,
} as const

const iconColorByVariant = {
  warning: "text-warning",
  error: "text-destructive",
  success: "text-success",
  info: "text-info",
  default: "text-background",
} as const

export type InlineToastVariant = keyof typeof iconByVariant

export type ValidityMessages = {
  valueMissing: string
  typeMismatch: string
  patternMismatch: string
  tooShort: string
  tooLong: string
  rangeUnderflow: string
  rangeOverflow: string
  stepMismatch: string
  badInput: string
}

const defaultValidityMessages: ValidityMessages = {
  valueMissing: "Fill out this field",
  typeMismatch: "Enter a valid value",
  patternMismatch: "Enter a valid value",
  tooShort: "Enter a longer value",
  tooLong: "Enter a shorter value",
  rangeUnderflow: "Enter a higher value",
  rangeOverflow: "Enter a lower value",
  stepMismatch: "Enter a valid value",
  badInput: "Enter a valid value",
}

const validityKeys = [
  "valueMissing",
  "typeMismatch",
  "patternMismatch",
  "tooShort",
  "tooLong",
  "rangeUnderflow",
  "rangeOverflow",
  "stepMismatch",
  "badInput",
] as const satisfies ReadonlyArray<keyof ValidityMessages>

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

export type InputValidationProps = {
  validationMessage?: string | null
  validationMessages?: Partial<ValidityMessages>
  onValidationClear?: () => void
}
const FieldToastContext = createContext(false)
const invalidControlSelector = "input:invalid, textarea:invalid, select:invalid"

function isFormControl(target: EventTarget | null): target is FormControl {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

export function validityMessage(
  control: FormControl,
  messages?: Partial<ValidityMessages>
) {
  if (control.validity.customError) return control.validationMessage
  const input = control instanceof HTMLInputElement ? control : null
  const text =
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement
      ? control
      : null
  const copy: ValidityMessages = {
    ...defaultValidityMessages,
    ...(input?.type === "email"
      ? {
          valueMissing: "Enter your email",
          typeMismatch: "Enter a valid email",
        }
      : {}),
    ...(input?.type === "url" ? { typeMismatch: "Enter a valid URL" } : {}),
    ...(input?.type === "file" ? { valueMissing: "Choose a file" } : {}),
    ...(input?.type === "checkbox"
      ? { valueMissing: "Select this option to continue" }
      : {}),
    ...(text && text.minLength > 0
      ? { tooShort: `Use at least ${text.minLength} characters` }
      : {}),
    ...(text && text.maxLength >= 0
      ? { tooLong: `Use no more than ${text.maxLength} characters` }
      : {}),
    ...(input?.min ? { rangeUnderflow: `Enter ${input.min} or more` } : {}),
    ...(input?.max ? { rangeOverflow: `Enter ${input.max} or less` } : {}),
    ...(control.title ? { patternMismatch: control.title } : {}),
    ...messages,
  }
  for (const key of validityKeys) {
    if (control.validity[key]) return copy[key]
  }
  return control.validationMessage || copy.badInput
}

export function reportFormValidity(form: HTMLFormElement) {
  if (form.checkValidity()) return true
  const first = form.querySelector(invalidControlSelector)
  if (first instanceof HTMLElement) first.focus()
  return false
}

type TooltipContentProps = ComponentProps<typeof TooltipContent>

function InlineToast({
  open = false,
  onOpenChange,
  variant = "warning",
  side = "top",
  align = "start",
  sideOffset,
  alignOffset,
  icon,
  trigger,
  id,
  className,
  children,
}: {
  open?: boolean
  onOpenChange?: ComponentProps<typeof Tooltip>["onOpenChange"]
  variant?: InlineToastVariant
  side?: TooltipContentProps["side"]
  align?: TooltipContentProps["align"]
  sideOffset?: TooltipContentProps["sideOffset"]
  alignOffset?: TooltipContentProps["alignOffset"]
  icon?: ReactNode
  trigger: ReactElement
  id?: string
  className?: string
  children?: ReactNode
}) {
  const Icon = iconByVariant[variant]

  return (
    <Tooltip open={open} onOpenChange={onOpenChange} disableHoverablePopup>
      <TooltipTrigger render={trigger} closeOnClick={false} delay={0} />
      {open && children ? (
        <TooltipContent
          id={id}
          side={side}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          role="alert"
          data-slot="inline-toast"
          data-variant={variant}
          className={className}
        >
          <span
            data-slot="inline-toast-icon"
            className={cn(
              "shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
              iconColorByVariant[variant]
            )}
          >
            {icon ?? <Icon />}
          </span>
          <span className="text-pretty">{children}</span>
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}

type ControlProps = {
  id?: string
  onInvalid?: (event: InvalidEvent<FormControl>) => void
  onInput?: (event: FormEvent<FormControl>) => void
  onChange?: (event: FormEvent<FormControl>) => void
  onFocus?: (event: FocusEvent<FormControl>) => void
  onBlur?: (event: FocusEvent<FormControl>) => void
  "aria-invalid"?: boolean | "true" | "false"
  "aria-describedby"?: string
}

function FieldToast({
  children,
  className,
  variant = "warning",
  message,
  messages,
  onClear,
  side,
  align,
  wrap = true,
}: {
  children: ReactElement<ControlProps>
  wrap?: boolean
  className?: string
  variant?: InlineToastVariant
  message?: string | null
  messages?: Partial<ValidityMessages>
  onClear?: () => void
  side?: TooltipContentProps["side"]
  align?: TooltipContentProps["align"]
}) {
  const toastId = useId()
  const [controlForm, setControlForm] = useState<HTMLFormElement | null>(null)
  const [focused, setFocused] = useState(false)
  const [constraintMessage, setConstraintMessage] = useState<string | null>(
    null
  )
  useEffect(() => {
    if (!constraintMessage && !message) return
    const reset = (event: Event) => {
      if (event.target !== controlForm) return
      setConstraintMessage(null)
      if (message) onClear?.()
    }
    document.addEventListener("reset", reset, true)
    return () => document.removeEventListener("reset", reset, true)
  }, [constraintMessage, message, onClear, controlForm])
  const child = Children.only(children)
  const shown = message ?? constraintMessage
  const open = Boolean(shown) && (Boolean(message) || focused)

  if (!isValidElement<ControlProps>(child)) {
    return children
  }

  function clear() {
    setConstraintMessage(null)
    if (message) onClear?.()
  }

  const describedBy =
    [open ? toastId : undefined, child.props["aria-describedby"]]
      .filter(Boolean)
      .join(" ") || undefined

  const toast = (
    <InlineToast
      id={toastId}
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key") setFocused(false)
      }}
      variant={variant}
      side={side}
      align={align}
      trigger={cloneElement(child, {
        "aria-invalid": shown ? true : child.props["aria-invalid"],
        "aria-describedby": describedBy,
        onInvalid: (event) => {
          event.preventDefault()
          if (isFormControl(event.currentTarget)) {
            setConstraintMessage(validityMessage(event.currentTarget, messages))
            const control = event.currentTarget
            setControlForm(control.form)
            const first = control.form?.querySelector(invalidControlSelector)
            if (!first || first === control) {
              setFocused(true)
              control.focus()
            }
          }
          child.props.onInvalid?.(event)
        },
        onFocus: (event) => {
          setControlForm(event.currentTarget.form)
          setFocused(true)
          child.props.onFocus?.(event)
        },
        onBlur: (event) => {
          setFocused(false)
          child.props.onBlur?.(event)
        },
        onInput: (event) => {
          clear()
          child.props.onInput?.(event)
        },
        onChange: (event) => {
          clear()
          child.props.onChange?.(event)
        },
      })}
    >
      {shown}
    </InlineToast>
  )
  return (
    <FieldToastContext.Provider value={true}>
      {wrap ? (
        <div data-slot="field-toast" className={cn("w-full", className)}>
          {toast}
        </div>
      ) : (
        toast
      )}
    </FieldToastContext.Provider>
  )
}

/** Default validation for primitives; an explicit FieldToast takes precedence. */
function InputValidation({
  children,
  validationMessage,
  validationMessages,
  onValidationClear,
}: InputValidationProps & { children: ReactElement<ControlProps> }) {
  const alreadyWrapped = useContext(FieldToastContext)
  if (alreadyWrapped) return children
  return (
    <FieldToast
      wrap={false}
      variant={validationMessage ? "error" : "warning"}
      message={validationMessage}
      messages={validationMessages}
      onClear={onValidationClear}
    >
      {children}
    </FieldToast>
  )
}

function ValidatedForm({ onSubmit, ...props }: ComponentProps<"form">) {
  return (
    <form
      {...props}
      noValidate
      onSubmit={(event) => {
        if (!reportFormValidity(event.currentTarget)) {
          event.preventDefault()
          return
        }
        onSubmit?.(event)
      }}
    />
  )
}

export { FieldToast, InlineToast, InputValidation, ValidatedForm }
