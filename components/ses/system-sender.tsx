"use client"

import * as React from "react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import { SettingsCard, SuggestInput } from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { parseMailbox } from "@/lib/dashboard/email-send"

export function SystemSender() {
  const sender = useQuery(api.systemEmail.settings)
  if (sender === undefined) return <Skeleton className="h-64 w-full" />
  return (
    <SenderForm key={`${sender?.domainId}:${sender?.from}`} sender={sender} />
  )
}

function SenderForm({
  sender,
}: {
  sender: FunctionReturnType<typeof api.systemEmail.settings>
}) {
  const setSender = useMutation(api.systemEmail.setSender)
  const mailbox = sender ? parseMailbox(sender.from) : null
  const [name, setName] = React.useState(mailbox?.name ?? "Opensend")
  const [localPart, setLocalPart] = React.useState(
    mailbox?.address.split("@")[0] ?? "no-reply"
  )
  const [domain, setDomain] = React.useState(
    sender
      ? {
          value: sender.domainId,
          label: mailbox?.address.split("@")[1] ?? "",
        }
      : undefined
  )
  const [search, setSearch] = React.useState("")
  const domains = useQuery(api.systemEmail.domains, {
    search,
    selectedId: domain?.value as Id<"domains"> | undefined,
  })
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
  const id = React.useId()
  async function save(clear = false) {
    if (pending) return
    setPending(true)
    setError("")
    try {
      if (!clear && !domain) throw new Error("Choose a verified sending domain")
      const domainName =
        domains?.find((row) => row._id === domain?.value)?.name ??
        domain?.label.split(" · ")[0]
      const address = `${localPart.trim()}@${domainName}`
      await setSender(
        clear
          ? {}
          : {
              domainId: domain!.value as Id<"domains">,
              from: name.trim() ? `${name.trim()} <${address}>` : address,
            }
      )
      toast.add({
        type: "success",
        title: clear
          ? "Account email sender cleared"
          : "Account email sender saved",
      })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
  }
  return (
    <SettingsCard
      title="Account email sender"
      description="Send account emails and export notifications from a verified domain."
      footer={
        <>
          <Button type="submit" form={id} disabled={pending || !domain}>
            Save
          </Button>
          <Button
            variant="outline"
            disabled={pending || !sender}
            onClick={() => void save(true)}
          >
            Clear
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-domain`}>Sending domain</FieldLabel>
            <SuggestInput
              id={`${id}-domain`}
              value={domain?.value ?? ""}
              selectedItem={domain}
              options={(domains ?? []).map((row) => ({
                value: row._id,
                label: `${row.name} · ${row.region}`,
              }))}
              onSearch={setSearch}
              onChange={(value) => {
                const row = domains?.find((item) => item._id === value)
                if (row)
                  setDomain({
                    value: row._id,
                    label: `${row.name} · ${row.region}`,
                  })
              }}
              allowCreate={false}
              disabled={pending}
              placeholder="Select domain"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>From name</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-local`}>From local part</FieldLabel>
            <Input
              id={`${id}-local`}
              value={localPart}
              onChange={(event) => setLocalPart(event.target.value)}
              required
              disabled={pending}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </FieldGroup>
      </form>
    </SettingsCard>
  )
}
