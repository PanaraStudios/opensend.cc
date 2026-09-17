"use client"

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ComponentProps,
  type FormEvent,
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
  const copy = { ...defaultValidityMessages, ...messages }
  for (const key of validityKeys) {
    if (control.validity[key]) return copy[key]
  }
  return control.validationMessage || copy.badInput
}

export function reportFormValidity(form: HTMLFormElement) {
  if (form.checkValidity()) return true
  const first = form.querySelector(":invalid")
  if (first instanceof HTMLElement) first.focus()
  return false
}

type TooltipContentProps = ComponentProps<typeof TooltipContent>

function InlineToast({
  open = false,
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
    <Tooltip open={open} disableHoverablePopup>
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
}: {
  children: ReactElement<ControlProps>
  className?: string
  variant?: InlineToastVariant
  message?: string | null
  messages?: Partial<ValidityMessages>
  onClear?: () => void
  side?: TooltipContentProps["side"]
  align?: TooltipContentProps["align"]
}) {
  const toastId = useId()
  const [constraintMessage, setConstraintMessage] = useState<string | null>(
    null
  )
  const child = Children.only(children)
  const shown = message ?? constraintMessage

  if (!isValidElement<ControlProps>(child)) {
    return children
  }

  function clear() {
    setConstraintMessage(null)
    if (message) onClear?.()
  }

  const describedBy =
    [shown ? toastId : undefined, child.props["aria-describedby"]]
      .filter(Boolean)
      .join(" ") || undefined

  return (
    <div data-slot="field-toast" className={cn("w-full", className)}>
      <InlineToast
        id={toastId}
        open={Boolean(shown)}
        variant={variant}
        side={side}
        align={align}
        trigger={cloneElement(child, {
          "aria-invalid": shown ? true : child.props["aria-invalid"],
          "aria-describedby": describedBy,
          onInvalid: (event) => {
            event.preventDefault()
            if (isFormControl(event.currentTarget)) {
              setConstraintMessage(
                validityMessage(event.currentTarget, messages)
              )
            }
            child.props.onInvalid?.(event)
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
    </div>
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

export { FieldToast, InlineToast, ValidatedForm }
