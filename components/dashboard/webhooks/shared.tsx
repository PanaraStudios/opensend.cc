"use client"

import * as React from "react"
import Link from "next/link"
import {
  CirclePauseIcon,
  CirclePlayIcon,
  EyeIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  WebhookIcon as LucideWebhookIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsCode,
  DocsSheet,
  MoreMenu,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { useDashboard } from "@/lib/dashboard/store"
import type { Webhook, WebhookEvent } from "@/lib/dashboard/types"
import {
  sortWebhookEvents,
  WEBHOOK_EVENT_GROUPS,
  webhookFormError,
} from "@/lib/dashboard/webhooks"

export const WebhookIcon = LucideWebhookIcon

export const WEBHOOK_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
]

export function WebhookStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "success" : "secondary"} dot>
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  )
}

const WEBHOOK_DOCS = [
  {
    title: "Deliveries",
    body: "Each event is sent to your endpoint as a JSON POST. Answer with a 2xx status to take it; anything else is retried with a growing delay.",
  },
  {
    title: "Verify the signature",
    body: "Every request is signed with the webhook's signing secret. Check the signature against the raw request body before you trust the payload.",
  },
  {
    title: "Payload",
    body: (
      <DocsCode>
        {`{
  "type": "email.delivered",
  "created_at": "2026-01-01T12:00:00.000Z",
  "data": {
    "email_id": "em_…",
    "to": ["ada@example.com"],
    "subject": "Welcome"
  }
}`}
      </DocsCode>
    ),
  },
]

export function WebhooksDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Webhooks"
      description="Real-time events, pushed to your server as they happen."
      sections={WEBHOOK_DOCS}
    />
  )
}

type WebhookFormValues = Pick<Webhook, "endpoint" | "events">

type WebhookFormProps = {
  onOpenChange: (open: boolean) => void
  /** The webhook being edited. Without one, the form adds a new webhook. */
  webhook?: Webhook | null
  onSubmit: (values: WebhookFormValues) => void
}

/** One form for adding and editing. The dialog mounts it only while open, so
    every reopen starts from the record it was given. */
export function WebhookFormDialog({
  open,
  ...form
}: WebhookFormProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={form.onOpenChange}>
      {open ? <WebhookForm {...form} /> : null}
    </Dialog>
  )
}

function WebhookForm({ webhook, onSubmit, onOpenChange }: WebhookFormProps) {
  const [endpoint, setEndpoint] = React.useState(webhook?.endpoint ?? "")
  const [events, setEvents] = React.useState<readonly WebhookEvent[]>(
    webhook?.events ?? []
  )
  const [error, setError] =
    React.useState<ReturnType<typeof webhookFormError>>(null)

  function toggle(targets: readonly WebhookEvent[], checked: boolean) {
    setEvents((current) =>
      checked
        ? [...new Set([...current, ...targets])]
        : current.filter((event) => !targets.includes(event))
    )
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = webhookFormError(endpoint, events)
    if (problem) {
      setError(problem)
      return
    }
    onSubmit({ endpoint: endpoint.trim(), events: sortWebhookEvents(events) })
    onOpenChange(false)
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{webhook ? "Edit webhook" : "Add webhook"}</DialogTitle>
          <DialogDescription>
            Each event you pick is sent to this URL as a signed POST request.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="webhook-endpoint">Endpoint URL</FieldLabel>
            <Input
              id="webhook-endpoint"
              type="url"
              value={endpoint}
              placeholder="https://example.com/webhooks"
              autoFocus
              onChange={(event) => {
                setEndpoint(event.target.value)
                setError(null)
              }}
            />
            {error?.endpoint ? <FieldError>{error.endpoint}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>Events</FieldLabel>
            <div className="flex max-h-64 flex-col gap-4 overflow-auto rounded-lg border border-border p-3">
              {WEBHOOK_EVENT_GROUPS.map((group) => {
                const picked = group.events.filter((event) =>
                  events.includes(event)
                ).length
                return (
                  <div key={group.id} className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox
                        checked={picked === group.events.length}
                        indeterminate={
                          picked > 0 && picked < group.events.length
                        }
                        onCheckedChange={(checked) =>
                          toggle(group.events, checked === true)
                        }
                      />
                      {group.label}
                    </label>
                    <div className="grid gap-2 pl-6 sm:grid-cols-2">
                      {group.events.map((event) => (
                        <label
                          key={event}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={events.includes(event)}
                            onCheckedChange={(checked) =>
                              toggle([event], checked === true)
                            }
                          />
                          <span className="font-mono text-[12px]">{event}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {error?.events ? <FieldError>{error.events}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit">{webhook ? "Save" : "Add"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** The "…" menu of one webhook, with the dialogs it opens. The list's rows
    and the webhook's own page both use it. */
export function WebhookMenu({
  webhook,
  inDetail = false,
  onDelete,
}: {
  webhook: Webhook
  /** The webhook's page links nowhere, and is where the secret is rotated. */
  inDetail?: boolean
  /** Replaces the plain delete, for a page that has to leave first. */
  onDelete?: () => void
}) {
  const { updateWebhook, deleteWebhook, rotateWebhookSecret } = useDashboard()
  const [editing, setEditing] = React.useState(false)
  const [rotating, setRotating] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  return (
    <>
      <MoreMenu>
        <DropdownMenuGroup>
          {inDetail ? null : (
            <DropdownMenuItem
              render={<Link href={`/webhooks/${webhook.id}`} />}
            >
              <EyeIcon />
              View webhook
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit webhook
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              updateWebhook(webhook.id, { enabled: !webhook.enabled })
              toast.add({
                type: "success",
                title: webhook.enabled ? "Webhook disabled" : "Webhook enabled",
              })
            }}
          >
            {webhook.enabled ? <CirclePauseIcon /> : <CirclePlayIcon />}
            {webhook.enabled ? "Disable" : "Enable"}
          </DropdownMenuItem>
          {inDetail ? (
            <DropdownMenuItem onClick={() => setRotating(true)}>
              <RefreshCwIcon />
              Rotate secret
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </MoreMenu>
      <WebhookFormDialog
        open={editing}
        onOpenChange={setEditing}
        webhook={webhook}
        onSubmit={(values) => {
          updateWebhook(webhook.id, values)
          toast.add({ type: "success", title: "Webhook updated" })
        }}
      />
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title="Rotate signing secret?"
        description="Payloads are signed with the new secret from now on. Anything still verifying with the old one starts rejecting them."
        confirmLabel="Rotate"
        onConfirm={() => {
          rotateWebhookSecret(webhook.id)
          toast.add({ type: "success", title: "Secret rotated" })
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete webhook?"
        description="Events stop going to this endpoint right away, and its delivery history is removed."
        onConfirm={() => {
          if (onDelete) onDelete()
          else deleteWebhook(webhook.id)
          toast.add({ type: "success", title: "Webhook deleted" })
        }}
      />
    </>
  )
}
