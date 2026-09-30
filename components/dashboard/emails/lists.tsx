"use client"

import { useExportDialog } from "@/components/dashboard/export-dialog"

import * as React from "react"
import Link from "next/link"
import type { DateRange } from "react-day-picker"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsButton,
  EmailStatusBadge,
  EmptyState,
  ListPagination,
  ListToolbar,
  MoreMenu,
  OptionSelect,
  ResourceTable,
  Th,
  useListSearch,
} from "@/components/dashboard/primitives"
import {
  CircleMinusIcon,
  CircleSlashIcon,
  EyeIcon,
  InboxIcon,
  MailIcon,
  ScrollTextIcon,
} from "lucide-react"
import {
  EmailsChrome,
  ORIGIN_ITEMS,
  REASON_ITEMS,
  STATUS_ITEMS,
  defaultEmailRange,
  isFilterableStatus,
  isSuppressionReason,
} from "@/components/dashboard/emails/shared"
import {
  formatDateTime,
  isEmail,
  suppressionReasonLabel,
} from "@/lib/dashboard/format"
import { actionError } from "@/lib/action-error"
import { rangeBounds } from "@/lib/dashboard/email-range"
import {
  useReceivedList,
  useReceivingDomain,
} from "@/lib/received/use-received"
import { useClock } from "@/lib/time/use-clock"
import type { SuppressionReason } from "@/lib/dashboard/types"
import {
  useEmailCommands,
  useEmailList,
  useSuppressionList,
} from "@/lib/emails/use-emails"

export function EmailsView() {
  const now = useClock() ?? undefined
  const { query, setQuery, search } = useListSearch()
  const [status, setStatus] = React.useState("all")
  const [range, setRange] = React.useState<DateRange | undefined>(() =>
    defaultEmailRange(Date.now())
  )

  const filters = {
    status: isFilterableStatus(status) ? status : undefined,
    search: search.trim() || undefined,
    ...rangeBounds(range),
  }
  const emails = useEmailList(filters)
  const rows = emails.rows
  const { pageRows, pagination } = emails
  const exporting = useExportDialog({
    resource: "emails",
    noun: "emails",
    filters,
  })

  return (
    <EmailsChrome actions={<DocsButton />}>
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search emails…"
        range={range}
        onRangeChange={setRange}
        now={now}
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
        onExport={exporting.open}
      />
      {emails.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MailIcon}
          title="No emails"
          description="Send a message with POST /emails from the API and it appears here with its delivery events."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>To</Th>
                <Th>Status</Th>
                <Th>Sent</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((email) => (
              <TableRow key={email.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={`/emails/${email.id}`}
                      className="font-medium hover:underline"
                    >
                      {email.to}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {email.subject}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <EmailStatusBadge status={email.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(email.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<Link href={`/emails/${email.id}`} />}
                      >
                        <EyeIcon />
                        View email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        render={<Link href={`/logs?email=${email.id}`} />}
                      >
                        <ScrollTextIcon />
                        View log
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="email" />
        </>
      )}
    </EmailsChrome>
  )
}

export function ReceivingView() {
  const { query, setQuery, search } = useListSearch()
  const now = useClock() ?? undefined
  const [range, setRange] = React.useState<DateRange | undefined>(() =>
    defaultEmailRange(Date.now())
  )
  const receivingDomain = useReceivingDomain()
  const filters = { search: search.trim() || undefined, ...rangeBounds(range) }
  const received = useReceivedList(filters)
  const { rows, pageRows, pagination } = received
  const exporting = useExportDialog({
    resource: "received",
    noun: "received emails",
    filters,
  })

  return (
    <EmailsChrome>
      <div className="flex flex-col gap-2">
        {receivingDomain ? (
          <p className="text-sm text-muted-foreground">
            Receiving on{" "}
            <span className="font-mono">*@{receivingDomain.name}</span>
          </p>
        ) : null}
        {exporting.dialog}
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search received…"
          range={range}
          onRangeChange={setRange}
          now={now}
          onExport={exporting.open}
        />
      </div>
      {received.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No received emails"
          description="Enable receiving on a verified domain, then send a message to that address."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Received</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((email) => (
              <TableRow key={email.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={`/emails/receiving/${email.id}`}
                      className="font-medium hover:underline"
                    >
                      {email.from}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {email.subject}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {email.to}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(email.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<Link href={`/emails/receiving/${email.id}`} />}
                      >
                        <EyeIcon />
                        View email
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="email" />
        </>
      )}
    </EmailsChrome>
  )
}

export function SuppressionsView() {
  const { addSuppression, removeSuppression } = useEmailCommands()
  const now = useClock() ?? undefined
  const { query, setQuery, search } = useListSearch()
  const [origin, setOrigin] = React.useState("all")
  const [range, setRange] = React.useState<DateRange | undefined>(() =>
    defaultEmailRange(Date.now())
  )
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [reason, setReason] = React.useState<SuppressionReason>("manual")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)

  const filters = {
    reason: isSuppressionReason(origin) ? origin : undefined,
    search: search.trim() || undefined,
    ...rangeBounds(range),
  }
  const suppressions = useSuppressionList(filters)
  const rows = suppressions.rows
  const { pageRows, pagination } = suppressions

  function reset() {
    setEmail("")
    setReason("manual")
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!isEmail(email)) {
      setError("Enter a valid email")
      return
    }
    try {
      await addSuppression({ email, reason })
    } catch (e) {
      setError(actionError(e))
      return
    }
    toast.add({ type: "success", title: "Address suppressed" })
    reset()
    setOpen(false)
  }

  const exporting = useExportDialog({
    resource: "suppressions",
    noun: "suppressions",
    filters,
  })

  return (
    <EmailsChrome
      actions={
        <Button onClick={() => setOpen(true)}>
          <CircleSlashIcon data-icon="inline-start" />
          Add suppression
        </Button>
      }
    >
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search suppressions…"
        range={range}
        onRangeChange={setRange}
        now={now}
        filters={[
          {
            value: origin,
            onChange: setOrigin,
            items: ORIGIN_ITEMS,
            "aria-label": "Filter by origin",
          },
        ]}
        onExport={exporting.open}
      />
      {suppressions.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CircleSlashIcon}
          title="No suppressions"
          description="Bounces and complaints will appear here. You can also add an address by hand."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Email</Th>
                <Th>Origin</Th>
                <Th>Added</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {suppressionReasonLabel(item.reason)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setPending(item.id)}
                      >
                        <CircleMinusIcon />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="suppression" />
        </>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset()
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Add suppression</DialogTitle>
              <DialogDescription>
                Future sends to this address are skipped and recorded as
                suppressed.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="sup-email">Email</FieldLabel>
                <Input
                  id="sup-email"
                  type="email"
                  value={email}
                  autoFocus
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setError(null)
                  }}
                />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-reason">Reason</FieldLabel>
                <OptionSelect
                  id="sup-reason"
                  className="w-full"
                  value={reason}
                  onChange={(next) => {
                    if (isSuppressionReason(next)) setReason(next)
                  }}
                  items={REASON_ITEMS}
                />
                <FieldDescription>
                  Manual entries are yours. Bounce and complaint reasons match
                  SES events.
                </FieldDescription>
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
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Remove suppression?"
        description="This address can receive mail again. Use only when you know the bounce or complaint is resolved."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (pending) await removeSuppression(pending)
          toast.add({ type: "success", title: "Suppression removed" })
        }}
      />
    </EmailsChrome>
  )
}
