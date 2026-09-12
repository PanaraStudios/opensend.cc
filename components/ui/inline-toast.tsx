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
  type SVGProps,
} from "react"
import { cn } from "cn"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/* Untitled UI Solid icons, PRO v1.6. Status marks sit inside TooltipContent. */
function SolidIcon({
  d,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={d} />
    </svg>
  )
}

function AlertTriangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M12.8126 1.66837C12.2953 1.43834 11.7047 1.43834 11.1874 1.66837C10.7878 1.84602 10.5283 2.15894 10.3477 2.41391C10.1701 2.66461 9.98004 2.99303 9.77096 3.35422L1.50381 17.6339C1.2939 17.9964 1.10315 18.3258 0.973806 18.6054C0.842356 18.8895 0.699752 19.2714 0.745201 19.7074C0.804012 20.2715 1.09955 20.7841 1.55827 21.1176C1.91276 21.3753 2.31476 21.4433 2.62652 21.4719C2.93327 21.5 3.31392 21.5 3.73281 21.5H20.2671C20.686 21.5 21.0667 21.5 21.3734 21.4719C21.6852 21.4433 22.0872 21.3753 22.4417 21.1176C22.9004 20.7841 23.1959 20.2715 23.2547 19.7074C23.3002 19.2714 23.1576 18.8895 23.0261 18.6054C22.8968 18.3258 22.7061 17.9964 22.4962 17.6339L14.229 3.35419C14.0199 2.99301 13.8298 2.66459 13.6522 2.41391C13.4716 2.15894 13.2121 1.84602 12.8126 1.66837ZM13 9C13 8.44772 12.5523 8 12 8C11.4477 8 11 8.44772 11 9V13C11 13.5523 11.4477 14 12 14C12.5523 14 13 13.5523 13 13V9ZM12 16C11.4477 16 11 16.4477 11 17C11 17.5523 11.4477 18 12 18H12.01C12.5623 18 13.01 17.5523 13.01 17C13.01 16.4477 12.5623 16 12.01 16H12Z"
      {...props}
    />
  )
}

function AlertCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1ZM13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8V12C11 12.5523 11.4477 13 12 13C12.5523 13 13 12.5523 13 12V8ZM12 15C11.4477 15 11 15.4477 11 16C11 16.5523 11.4477 17 12 17H12.01C12.5623 17 13.01 16.5523 13.01 16C13.01 15.4477 12.5623 15 12.01 15H12Z"
      {...props}
    />
  )
}

function CheckCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1ZM17.2071 9.70711C17.5976 9.31658 17.5976 8.68342 17.2071 8.29289C16.8166 7.90237 16.1834 7.90237 15.7929 8.29289L10.5 13.5858L8.20711 11.2929C7.81658 10.9024 7.18342 10.9024 6.79289 11.2929C6.40237 11.6834 6.40237 12.3166 6.79289 12.7071L9.79289 15.7071C10.1834 16.0976 10.8166 16.0976 11.2071 15.7071L17.2071 9.70711Z"
      {...props}
    />
  )
}

function InfoCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1ZM12 7C11.4477 7 11 7.44772 11 8C11 8.55228 11.4477 9 12 9H12.01C12.5623 9 13.01 8.55228 13.01 8C13.01 7.44772 12.5623 7 12.01 7H12ZM13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12V16C11 16.5523 11.4477 17 12 17C12.5523 17 13 16.5523 13 16V12Z"
      {...props}
    />
  )
}

const iconByVariant = {
  warning: AlertTriangleIcon,
  error: AlertCircleIcon,
  success: CheckCircleIcon,
  info: InfoCircleIcon,
  default: InfoCircleIcon,
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
