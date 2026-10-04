"use client"

import * as React from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  requireTeamId,
  useTeamRole,
  useWorkspace,
  useTeamQuery,
} from "@/components/auth/workspace"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  ListPagination,
  OptionSelect,
  useTeamList,
} from "@/components/dashboard/primitives"
import { useTemplate } from "@/lib/templates/use-templates"
import {
  templateTestReady,
  templateTestRecipient,
} from "@/lib/dashboard/template-test"
import { actionError } from "@/lib/action-error"
import type { EmailTemplate } from "@/lib/dashboard/types"
import { CHANNELS } from "@/lib/channels"
import { FileUploadField } from "@/components/dashboard/file-upload"

/** One test action for Meta templates and template-based broadcasts. */
export function TemplateTestAction({
  templateId,
  accountId,
  variables = {},
  save,
}: {
  templateId?: string
  accountId?: string
  variables?: Record<string, string>
  save?: () => Promise<boolean>
}) {
  const item = useTemplate(templateId)
  const { canWrite } = useTeamRole()
  const [open, setOpen] = React.useState(false)
  const ready = !!item && templateTestReady(item)
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        data-testid="editor-test-message"
        disabled={!ready || !canWrite}
        title={
          ready
            ? "Send the published template to one recipient"
            : "Publish the template first; WhatsApp also requires Meta approval"
        }
        onClick={async () => {
          if (!save || (await save())) setOpen(true)
        }}
      >
        Send test
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && item ? (
          <TemplateTestForm
            item={item}
            accountId={accountId}
            variables={variables}
            onSent={() => setOpen(false)}
          />
        ) : null}
      </Dialog>
    </>
  )
}

function TemplateTestForm({
  item,
  accountId,
  variables,
  onSent,
}: {
  item: EmailTemplate
  accountId?: string
  variables: Record<string, string>
  onSent: () => void
}) {
  const { activeTeamId } = useWorkspace()
  const channel =
    item.channel === "instagram"
      ? "instagram"
      : item.channel === "messenger"
        ? "messenger"
        : "whatsapp"
  const [from, setFrom] = React.useState(accountId ?? "")
  const [to, setTo] = React.useState("")
  const [values, setValues] = React.useState(variables)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const send = useMutation(api.messages.sendTest)
  const accounts = useTeamList(
    api.channels.senders.list,
    api.channels.senders.count,
    { channel, search }
  )
  const options = accounts.pageRows.flatMap((row) =>
    row.kind === "account" &&
    row.account.status === "active" &&
    (channel !== "whatsapp" ||
      (row.account.registeredAt !== undefined &&
        row.account.wabaId === item.whatsapp?.wabaId))
      ? [
          {
            value: row.account._id,
            label: `${row.account.displayName || CHANNELS[channel].label} · ${row.account.handle}`,
          },
        ]
      : []
  )
  const definition = useTeamQuery(api.messages.testDefinition, {
    templateId: item.id as Id<"templates">,
  })
  const fields = definition?.variables ?? []
  return (
    <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (pending) return
          setError(null)
          setPending(true)
          try {
            const recipient = templateTestRecipient(channel, to)
            await send({
              organizationId: requireTeamId(activeTeamId),
              templateId: item.id as Id<"templates">,
              from,
              to: recipient,
              variables: values,
            })
            toast.add({ type: "success", title: "Test message queued" })
            onSent()
          } catch (error) {
            setError(actionError(error))
          } finally {
            setPending(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Send test</DialogTitle>
          <DialogDescription>
            Send the {channel === "whatsapp" ? "approved" : "published"}{" "}
            {CHANNELS[channel].label} template to one recipient. Template edits
            need to be published before testing.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="test-message-sender">Sender</FieldLabel>
            <OptionSelect
              id="test-message-sender"
              value={from}
              items={options}
              onChange={setFrom}
              search={{ onChange: setSearch }}
              placeholder="Choose a sender"
            />
            <ListPagination {...accounts.pagination} embedded noun="sender" />
          </Field>
          <Field>
            <FieldLabel htmlFor="test-message-recipient">
              {channel === "whatsapp" ? "Phone number" : "Recipient"}
            </FieldLabel>
            <Input
              id="test-message-recipient"
              data-testid="test-message-recipient"
              type={channel === "whatsapp" ? "tel" : "text"}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder={
                channel === "whatsapp"
                  ? "+15551234567"
                  : "Recipient from an existing conversation"
              }
              required
            />
            <FieldDescription>
              {channel === "whatsapp"
                ? "Include the country code. Meta charges apply to test messages."
                : "Use the recipient identifier from a conversation with this sender. The 24-hour conversation window must be open."}
            </FieldDescription>
          </Field>
          {fields
            .filter((field) => field.key !== "header_media")
            .map((field) => (
              <Field key={field.key}>
                <FieldLabel htmlFor={`test-variable-${field.key}`}>
                  {field.label}
                </FieldLabel>
                <Input
                  id={`test-variable-${field.key}`}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                  required
                />
              </Field>
            ))}
          {fields.some((field) => field.key === "header_media") ? (
            <FileUploadField
              label="Header media"
              use="whatsapp"
              from={from}
              disabled={!from}
              onRemoved={() => {
                const next = { ...values }
                delete next.header_media
                setValues(next)
              }}
              onUploaded={(id) =>
                setValues({ ...values, header_media: `opensend-file:${id}` })
              }
            />
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            data-testid="test-message-send"
            disabled={pending || !from || !to.trim() || !definition}
          >
            {pending ? "Sending…" : "Send test"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
