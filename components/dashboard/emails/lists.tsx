"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { DropdownMenuGroup } from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmailStatusBadge,
  EmptyState,
  MoreMenu,
  MoreMenuItem,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  BookOpenIcon,
  CircleSlashIcon,
  InboxIcon,
  MailIcon,
  PlusIcon,
} from "lucide-react"
import {
  EmailsChrome,
  EmailsToolbar,
  ORIGIN_ITEMS,
  REASON_ITEMS,
  STATUS_ITEMS,
  defaultEmailRange,
  filterEmailHaystack,
  inDateRange,
  isSuppressionReason,
} from "@/components/dashboard/emails/shared"
import { formatDateTime, isEmail, suppressionReasonLabel } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { SuppressionReason } from "@/lib/dashboard/types"

function SendEmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { sendEmail, state } = useDashboard()
  const verified = state.domains.find((domain) => domain.status === "verified")
  const [from, setFrom] = React.useState(
    verified ? `Opensend <hello@${verified.name}>` : "Opensend <hello@opensend.cc>"
  )
  const [to, setTo] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [text, setText] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setTo("")
    setSubject("")
    setText("")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!isEmail(to)) {
      setError("Enter a valid recipient")
      return
    }
    if (!subject.trim()) {
      setError("Enter a subject")
      return
    }
    const email = sendEmail({ from, to, subject, text: text || subject })
    toast.add({ type: "success", title: "Email sent" })
    reset()
    onOpenChange(false)
    router.push(`/emails/${email.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Send email</DialogTitle>
            <DialogDescription>
              Transactional send from this workspace. Delivery goes through the
              SES connection on this server.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="send-from">From</FieldLabel>
              <Input
                id="send-from"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="send-to">To</FieldLabel>
              <Input
                id="send-to"
                type="email"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  setError(null)
                }}
                placeholder="ada@example.com"
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="send-subject">Subject</FieldLabel>
              <Input
                id="send-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="send-body">Text</FieldLabel>
              <Textarea
                id="send-body"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Send</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EmailsDocsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Emails</SheetTitle>
          <SheetDescription>
            Sending, inbound mail, and the suppression list share this section.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Sending</p>
            <p className="text-muted-foreground">
              POST /emails from the API or the Send email dialog. Events land on
              the message as they arrive from SES.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Receiving</p>
            <p className="text-muted-foreground">
              Enable receiving on a verified domain, then send to that inbound
              address. Replay missed deliveries from Webhooks.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Suppressions</p>
            <p className="text-muted-foreground">
              Hard bounces and complaints are added automatically. Manual
              entries skip future sends to that address.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function EmailsView() {
  const { state, addExport } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [range, setRange] = React.useState<DateRange | undefined>(defaultEmailRange)
  const [open, setOpen] = React.useState(false)
  const [docsOpen, setDocsOpen] = React.useState(false)

  const rows = state.emails.filter((email) => {
    if (!filterEmailHaystack(query, email)) return false
    if (status !== "all" && email.status !== status) return false
    return inDateRange(email.createdAt, range)
  })

  return (
    <EmailsChrome
      actions={
        <>
          <Button variant="outline" onClick={() => setDocsOpen(true)}>
            <BookOpenIcon data-icon="inline-start" />
            Docs
          </Button>
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Send email
          </Button>
        </>
      }
    >
      <EmailsToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search emails…"
        range={range}
        onRangeChange={setRange}
        select={{
          value: status,
          onChange: setStatus,
          items: STATUS_ITEMS,
          "aria-label": "Filter by status",
        }}
        onExport={() => {
          addExport("Emails", rows.length)
          toast.add({ type: "success", title: "Export started" })
        }}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={MailIcon}
          title="No emails"
          description="Send a test message or wait for the API to land events here."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Send email
          </Button>
        </EmptyState>
      ) : (
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
          {rows.map((email) => (
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
                    <MoreMenuItem render={<Link href={`/emails/${email.id}`} />}>
                      View email
                    </MoreMenuItem>
                    <MoreMenuItem render={<Link href={`/logs?email=${email.id}`} />}>
                      View log
                    </MoreMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <SendEmailDialog open={open} onOpenChange={setOpen} />
      <EmailsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </EmailsChrome>
  )
}

export function ReceivingView() {
  const { state, addExport } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [range, setRange] = React.useState<DateRange | undefined>(defaultEmailRange)
  const receivingDomain = state.domains.find((domain) => domain.receiving)

  const rows = state.received.filter((email) => {
    if (!filterEmailHaystack(query, email)) return false
    return inDateRange(email.createdAt, range)
  })

  return (
    <EmailsChrome>
      <div className="flex flex-col gap-2">
        {receivingDomain ? (
          <p className="text-sm text-muted-foreground">
            Receiving on{" "}
            <span className="font-mono">inbound@{receivingDomain.name}</span>
          </p>
        ) : null}
        <EmailsToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search received…"
          range={range}
          onRangeChange={setRange}
          onExport={() => {
            addExport("Received emails", rows.length)
            toast.add({ type: "success", title: "Export started" })
          }}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No received emails"
          description="Enable receiving on a verified domain, then send a message to that address."
        />
      ) : (
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
          {rows.map((email) => (
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
              <TableCell className="text-muted-foreground">{email.to}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(email.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuGroup>
                    <MoreMenuItem
                      render={<Link href={`/emails/receiving/${email.id}`} />}
                    >
                      View email
                    </MoreMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
    </EmailsChrome>
  )
}

export function SuppressionsView() {
  const { state, addSuppression, removeSuppression, addExport } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [origin, setOrigin] = React.useState("all")
  const [range, setRange] = React.useState<DateRange | undefined>(defaultEmailRange)
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [reason, setReason] = React.useState<SuppressionReason>("manual")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)

  const rows = state.suppressions.filter((item) => {
    if (!filterEmailHaystack(query, { to: item.email })) return false
    if (origin !== "all" && item.reason !== origin) return false
    return inDateRange(item.createdAt, range)
  })

  function reset() {
    setEmail("")
    setReason("manual")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!isEmail(email)) {
      setError("Enter a valid email")
      return
    }
    addSuppression({ email, reason })
    toast.add({ type: "success", title: "Address suppressed" })
    reset()
    setOpen(false)
  }

  return (
    <EmailsChrome
      actions={
        <Button onClick={() => setOpen(true)}>
          <CircleSlashIcon data-icon="inline-start" />
          Add suppression
        </Button>
      }
    >
      <EmailsToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search suppressions…"
        range={range}
        onRangeChange={setRange}
        allowAllTime
        select={{
          value: origin,
          onChange: setOrigin,
          items: ORIGIN_ITEMS,
          "aria-label": "Filter by origin",
        }}
        onExport={() => {
          addExport("Suppressions", rows.length)
          toast.add({ type: "success", title: "Export started" })
        }}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={CircleSlashIcon}
          title="No suppressions"
          description="Bounces and complaints will appear here. You can also add an address by hand."
        />
      ) : (
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
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.email}</TableCell>
              <TableCell>
                <Badge variant="secondary">{suppressionReasonLabel(item.reason)}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(item.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuGroup>
                    <MoreMenuItem
                      variant="destructive"
                      onClick={() => setPending(item.id)}
                    >
                      Remove
                    </MoreMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
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
                <Select
                  value={reason}
                  onValueChange={(next) => {
                    if (next && isSuppressionReason(next)) setReason(next)
                  }}
                  items={[...REASON_ITEMS]}
                >
                  <SelectTrigger id="sup-reason" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {REASON_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Manual entries are yours. Bounce and complaint reasons match
                  SES events.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Remove suppression?"
        description="This address can receive mail again. Use only when you know the bounce or complaint is resolved."
        confirmLabel="Remove"
        onConfirm={() => {
          if (pending) removeSuppression(pending)
          toast.add({ type: "success", title: "Suppression removed" })
        }}
      />
    </EmailsChrome>
  )
}
