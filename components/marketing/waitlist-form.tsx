"use client"

import { FormEvent, useState } from "react"

import { joinWaitlist } from "@/app/actions/waitlist"
import { Check, Cloud } from "@/components/marketing/icons"
import { Button } from "@/components/ui/button"
import { FieldToast, ValidatedForm } from "@/components/ui/inline-toast"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { WAITLIST } from "@/content/landing"

export function WaitlistForm() {
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyJoined, setAlreadyJoined] = useState(false)
  const [joined, setJoined] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const address = email.trim()

    setPending(true)
    setError(null)

    try {
      const result = await joinWaitlist(address)
      if (result.ok) {
        setAlreadyJoined(result.alreadyJoined)
        setJoined(true)
        return
      }
      setError(result.message)
    } catch {
      setError("Could not join the waitlist. Try again in a moment.")
    } finally {
      setPending(false)
    }
  }

  if (joined) {
    return (
      <div
        className="mx-auto flex w-full max-w-md flex-col items-center gap-2 text-center"
        role="status"
      >
        <span className="pill">
          <Check strokeWidth={1.75} />
          {alreadyJoined ? WAITLIST.alreadyJoined : WAITLIST.successTitle}
        </span>
        <p className="text-caption text-faint-foreground">
          {WAITLIST.successBody}
        </p>
      </div>
    )
  }

  return (
    <ValidatedForm
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-3"
      data-umami-event="waitlist_join"
    >
      <label htmlFor="waitlist-email" className="sr-only">
        {WAITLIST.emailLabel}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <FieldToast
          className="min-w-0 flex-1"
          variant={error ? "error" : "warning"}
          message={error}
          onClear={() => setError(null)}
          messages={{
            valueMissing: WAITLIST.emptyEmail,
            typeMismatch: WAITLIST.invalidEmail,
          }}
        >
          <Input
            id="waitlist-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder={WAITLIST.placeholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </FieldToast>
        <Button
          type="submit"
          size="lg"
          className="sm:w-auto"
          disabled={pending}
        >
          {pending ? <Spinner /> : <Cloud />}
          {pending ? WAITLIST.submitting : WAITLIST.submit}
        </Button>
      </div>
    </ValidatedForm>
  )
}
