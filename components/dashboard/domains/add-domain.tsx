"use client"

import { EmailConfiguration } from "@/components/ses/email-configuration"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { OptionSelect, SetupDetails } from "@/components/dashboard/primitives"
import { REGION_ITEMS } from "@/components/dashboard/domains/shared"
import {
  DEFAULT_RETURN_PATH,
  validateDnsLabel,
  validateDomainName,
} from "@/lib/dashboard/domains"
import { api } from "@/convex/_generated/api"
import { useDomainCommands } from "@/lib/domains/use-domains"
import { actionError } from "@/lib/action-error"
import type { Region } from "@/lib/dashboard/types"

export function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addDomain, claimDomain } = useDomainCommands()
  const installation = useQuery(api.installation.status)
  const [inUse, setInUse] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [name, setName] = React.useState("")
  const [chosenRegion, setRegion] = React.useState<Region | undefined>()
  const region =
    chosenRegion ?? installation?.installation?.defaultRegion ?? "us-east-1"
  const [returnPath, setReturnPath] = React.useState(DEFAULT_RETURN_PATH)
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setInUse(false)
    setName("")
    setRegion(undefined)
    setReturnPath(DEFAULT_RETURN_PATH)
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const nameError = validateDomainName(name, [])
    if (nameError) {
      setError(nameError)
      return
    }
    const pathError = validateDnsLabel(returnPath)
    if (pathError) {
      setError(pathError)
      return
    }
    setPending(true)
    try {
      const id = await addDomain({
        name,
        region,
        customReturnPath: returnPath,
      })
      toast.add({
        type: "success",
        title: "Domain added",
        description: "Add the DNS records below, then start verification.",
      })
      reset()
      onOpenChange(false)
      router.push(`/domains/${id}`)
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "data" in e &&
        e.data &&
        typeof e.data === "object" &&
        "statusCode" in e.data &&
        e.data.statusCode === 403
      ) {
        setInUse(true)
        setError(null)
      } else setError(actionError(e))
    } finally {
      setPending(false)
    }
  }

  async function claim() {
    setPending(true)
    try {
      const result = await claimDomain({
        name,
        region,
        customReturnPath: returnPath,
      })
      reset()
      onOpenChange(false)
      router.push(`/domains/${result.domain_id}`)
    } catch (error) {
      setError(actionError(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add domain</DialogTitle>
          <DialogDescription>
            Use a domain you own. A subdomain such as{" "}
            <span className="font-mono">updates.example.com</span> keeps
            transactional reputation separate from marketing.
          </DialogDescription>
        </DialogHeader>
        <EmailConfiguration>
          <form onSubmit={submit}>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="domain-name">Name</FieldLabel>
                <Input
                  id="domain-name"
                  value={name}
                  onChange={(event) => {
                    setInUse(false)
                    setName(event.target.value)
                    setError(null)
                  }}
                  placeholder="updates.example.com"
                  autoFocus
                />
                {error ? (
                  <FieldError>{error}</FieldError>
                ) : (
                  <FieldDescription>
                    Do not include http:// or a trailing path.
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="domain-region">Region</FieldLabel>
                <OptionSelect
                  id="domain-region"
                  className="w-full"
                  value={region}
                  onChange={(next) => setRegion(next as Region)}
                  items={REGION_ITEMS.filter((item) =>
                    installation?.regions.some(
                      (saved) =>
                        saved.region === item.value && saved.phase === "ready"
                    )
                  )}
                />
                <FieldDescription>
                  The AWS region your SES identity lives in.
                </FieldDescription>
              </Field>
              <SetupDetails
                label="Advanced options"
                className="group -ml-2 w-fit text-foreground"
                iconClassName="-rotate-90 transition-transform group-data-[panel-open]:rotate-0"
              >
                <Field>
                  <FieldLabel htmlFor="domain-return-path">
                    Custom Return-Path
                  </FieldLabel>
                  <Input
                    id="domain-return-path"
                    value={returnPath}
                    onChange={(event) => {
                      setReturnPath(event.target.value)
                      setError(null)
                    }}
                    placeholder={DEFAULT_RETURN_PATH}
                  />
                  <FieldDescription>
                    Subdomain that carries the MX and SPF records for bounces.
                    It cannot be changed later.
                  </FieldDescription>
                </Field>
              </SetupDetails>
            </FieldGroup>
            {inUse && (
              <Alert variant="warning" className="mb-4">
                <AlertTitle>Domain already in use</AlertTitle>
                <AlertDescription>
                  This domain is registered by another team. If you own it, add
                  a TXT record to claim it.
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              {inUse ? (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => void claim()}
                >
                  {pending ? "Starting claim…" : "Claim domain"}
                </Button>
              ) : (
                <Button type="submit" disabled={pending}>
                  {pending ? "Adding…" : "Add domain"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </EmailConfiguration>
      </DialogContent>
    </Dialog>
  )
}
