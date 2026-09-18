"use client"

import * as React from "react"
import { PlusIcon, WebhookIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  MoreMenu,
  PageHeader,
  ResourceTable,
  ListToolbar,
  Surface,
  Th,
} from "@/components/dashboard/primitives"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { formatDate, isUrl, pluralize } from "@/lib/dashboard/format"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/dashboard/types"

export function WebhooksView() {
  const {
    state,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    rotateWebhookSecret,
  } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [endpoint, setEndpoint] = React.useState("")
  const [events, setEvents] = React.useState<WebhookEvent[]>([
    "email.delivered",
    "email.bounced",
  ])
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)
  const [secret, setSecret] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const rows = state.webhooks.filter((item) =>
    matchesNeedle(needle, item.endpoint)
  )

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setEvents((current) =>
      checked ? [...current, event] : current.filter((item) => item !== event)
    )
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!isUrl(endpoint)) {
      setError("Enter an http(s) endpoint")
      return
    }
    if (events.length === 0) {
      setError("Select at least one event")
      return
    }
    const result = createWebhook({ endpoint, events })
    setSecret(result.secret)
    toast.add({ type: "success", title: "Webhook created" })
    setEndpoint("")
    setEvents(["email.delivered", "email.bounced"])
    setError(null)
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Signed outgoing events. Map SES bounces, complaints, deliveries, and inbound mail to your app."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Add webhook
        </Button>
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search endpoints…"
      />
      {secret ? (
        <Surface>
          <p className="text-sm font-medium">Signing secret</p>
          <p className="text-small text-muted-foreground">
            Shown once. Store it to verify payloads.
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[13px] break-all">{secret}</code>
            <CopyButton value={secret} label="Secret" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setSecret(null)}>
            Dismiss
          </Button>
        </Surface>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks"
          description="Add an HTTPS endpoint and choose the events you want delivered."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Add webhook
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Endpoint</Th>
              <Th>Events</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <code className="font-mono text-[13px]">{item.endpoint}</code>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {pluralize(item.events.length, "event")}
              </TableCell>
              <TableCell>
                <Badge variant={item.enabled ? "success" : "secondary"} dot>
                  {item.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.createdAt)}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={(checked) =>
                      updateWebhook(item.id, { enabled: checked })
                    }
                    aria-label={`Toggle ${item.endpoint}`}
                  />
                  <MoreMenu>
                    <DropdownMenuItem
                      onClick={() => {
                        const next = rotateWebhookSecret(item.id)
                        setSecret(next)
                        toast.add({ type: "success", title: "Secret rotated" })
                      }}
                    >
                      Rotate secret
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPending(item.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </MoreMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setError(null)
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Add webhook</DialogTitle>
              <DialogDescription>
                We sign every payload. Verify with the secret shown after
                create.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="wh-url">Endpoint</FieldLabel>
                <Input
                  id="wh-url"
                  value={endpoint}
                  onChange={(event) => {
                    setEndpoint(event.target.value)
                    setError(null)
                  }}
                  placeholder="https://example.com/hooks"
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel>Events</FieldLabel>
                <div className="grid max-h-56 gap-2 overflow-auto rounded-lg border border-border p-3 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={events.includes(event)}
                        onCheckedChange={(checked) =>
                          toggleEvent(event, checked === true)
                        }
                      />
                      <span className="font-mono text-[12px]">{event}</span>
                    </label>
                  ))}
                </div>
                <FieldDescription>
                  Receiving uses email.received. Sending uses the rest.
                </FieldDescription>
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add endpoint</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete webhook?"
        description="New events will no longer be delivered to this endpoint."
        onConfirm={() => {
          if (pending) deleteWebhook(pending)
          toast.add({ type: "success", title: "Webhook deleted" })
        }}
      />
    </>
  )
}
