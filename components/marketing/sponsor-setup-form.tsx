"use client"

import { FormEvent, useState } from "react"

import { submitSponsorLogo } from "@/app/actions/sponsor"
import { CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldToast, ValidatedForm } from "@/components/ui/inline-toast"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { SPONSORS_THANKS } from "@/content/landing"
import { LOGO_ACCEPT } from "@/lib/sponsor-logo"

export function SponsorSetupForm({
  email,
  sessionId,
}: {
  email: string
  sessionId: string
}) {
  const copy = SPONSORS_THANKS.form
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      form.set("sessionId", sessionId)
      const result = await submitSponsorLogo(form)
      if (result.ok) {
        setSent(true)
        return
      }
      setError(result.message)
    } catch {
      setError(copy.error)
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <div
        className="flex flex-col items-center gap-2 text-center"
        role="status"
      >
        <span className="pill">
          <CheckIcon strokeWidth={1.75} />
          {copy.successTitle}
        </span>
        <p className="max-w-md text-caption text-faint-foreground">
          {copy.successBody}
        </p>
      </div>
    )
  }

  return (
    <ValidatedForm
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-3 text-left"
      data-umami-event="sponsor_logo_submit"
    >
      <p className="text-center text-caption text-faint-foreground">{email}</p>
      <FieldToast
        variant={error ? "error" : "warning"}
        message={error}
        onClear={() => setError(null)}
      >
        <Input
          id="sponsor-company"
          name="company"
          required
          autoComplete="organization"
          placeholder={copy.company}
          disabled={pending}
        />
      </FieldToast>
      <Input
        id="sponsor-website"
        type="url"
        name="website"
        required
        autoComplete="url"
        placeholder={copy.website}
        disabled={pending}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sponsor-logo">{copy.logo}</Label>
        <Input
          id="sponsor-logo"
          type="file"
          name="logo"
          required
          accept={LOGO_ACCEPT}
          disabled={pending}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sponsor-logo-dark">{copy.logoDark}</Label>
        <Input
          id="sponsor-logo-dark"
          type="file"
          name="logoDark"
          accept={LOGO_ACCEPT}
          disabled={pending}
        />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? copy.submitting : copy.submit}
      </Button>
    </ValidatedForm>
  )
}
