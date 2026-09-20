"use client"
import { useState, useId } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { LucideIcon } from "lucide-react"
import { actionError } from "@/lib/action-error"
export function FormInput({
  name,
  label,
  ...props
}: React.ComponentProps<typeof Input> & { name: string; label: string }) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={name} required {...props} />
    </Field>
  )
}
export function AsyncForm({
  children,
  onSubmit,
  submitLabel = "Save",
  success,
  disabled = false,
  submitVariant = "default",
  submitIcon: SubmitIcon,
  fullWidth = false,
}: {
  children?: React.ReactNode
  onSubmit: (data: FormData) => Promise<unknown>
  submitLabel?: string
  success?: string | false
  disabled?: boolean
  submitVariant?: React.ComponentProps<typeof Button>["variant"]
  submitIcon?: LucideIcon
  fullWidth?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending) return
        const data = new FormData(event.currentTarget)
        setPending(true)
        setError("")
        setMessage("")
        try {
          await onSubmit(data)
          setMessage(success === false ? "" : (success ?? "Saved"))
        } catch (e) {
          setError(actionError(e))
        } finally {
          setPending(false)
        }
      }}
    >
      <fieldset disabled={pending || disabled} className="flex flex-col gap-4">
        {children}
        <Button
          type="submit"
          variant={submitVariant}
          className={fullWidth ? "w-full" : "self-start"}
        >
          {SubmitIcon && <SubmitIcon data-icon="inline-start" />}
          {pending ? "Please wait…" : submitLabel}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  )
}
