"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, MailsIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmailStatusBadge,
  EmptyState,
  FilterSelect,
  MoreMenu,
  MoreMenuItem,
  PageHeader,
  ResourceTable,
  SearchField,
  SectionTabs,
  Surface,
  Th,
  Toolbar,
} from "@/components/dashboard/primitives"
import { EMAIL_TABS } from "@/lib/dashboard/nav"
import { formatDateTime, isEmail } from "@/lib/dashboard/format"
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
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
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

export function EmailsView() {
  const { state, addExport } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [open, setOpen] = React.useState(false)

  const rows = state.emails.filter((email) => {
    const haystack = `${email.to} ${email.from} ${email.subject}`.toLowerCase()
    if (query && !haystack.includes(query.trim().toLowerCase())) return false
    if (status && email.status !== status) return false
    return true
  })

  return (
    <>
      <PageHeader
        title="Emails"
        description="Sent and scheduled transactional mail. Received messages and the suppression list live in the other tabs."
      >
        <Button
          variant="outline"
          onClick={() => {
            addExport("Emails", rows.length)
            toast.add({ type: "success", title: "Export started" })
          }}
        >
          Export
        </Button>
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Send email
        </Button>
      </PageHeader>
      <SectionTabs items={EMAIL_TABS} />
      <Toolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search emails…"
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="All statuses"
          options={[
            "delivered",
            "opened",
            "clicked",
            "sent",
            "scheduled",
            "bounced",
            "failed",
            "canceled",
            "suppressed",
          ].map((value) => ({
            value,
            label: value.replaceAll("_", " "),
          }))}
        />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState
          icon={MailsIcon}
          title="No emails"
          description="Send a test message or wait for the API to land events here."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Send email
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>To</Th>
              <Th>Subject</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((email) => (
            <TableRow key={email.id}>
              <TableCell>
                <Link
                  href={`/emails/${email.id}`}
                  className="font-medium hover:underline"
                >
                  {email.to}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {email.subject}
              </TableCell>
              <TableCell>
                <EmailStatusBadge status={email.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(email.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <MoreMenuItem render={<Link href={`/emails/${email.id}`} />}>
                    View email
                  </MoreMenuItem>
                  {email.id ? (
                    <MoreMenuItem render={<Link href={`/logs?email=${email.id}`} />}>
                      View log
                    </MoreMenuItem>
                  ) : null}
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <SendEmailDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

export function EmailDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, cancelEmail } = useDashboard()
  const email = state.emails.find((item) => item.id === id)
  const [tab, setTab] = React.useState("preview")

  if (!email) {
    return (
      <EmptyState
        icon={MailsIcon}
        title="Email not found"
        description="It may have been pruned from this workspace."
      >
        <Button nativeButton={false} render={<Link href="/emails" />}>
          Back to emails
        </Button>
      </EmptyState>
    )
  }

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="-ml-2 text-muted-foreground"
          render={<Link href="/emails" />}
        >
          <ArrowLeftIcon />
          Emails
        </Button>
        <PageHeader title={email.subject}>
          {email.status === "scheduled" ? (
            <Button
              variant="outline"
              onClick={() => {
                cancelEmail(email.id)
                toast.add({ type: "success", title: "Send canceled" })
              }}
            >
              Cancel send
            </Button>
          ) : null}
        </PageHeader>
        <div className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <EmailStatusBadge status={email.status} />
          <span>{email.to}</span>
          <span>{formatDateTime(email.createdAt)}</span>
        </div>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <Surface>
          <h2 className="text-sm font-medium">Metadata</h2>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="font-mono text-caption text-muted-foreground">From</dt>
              <dd>{email.from}</dd>
            </div>
            <div>
              <dt className="font-mono text-caption text-muted-foreground">To</dt>
              <dd>{email.to}</dd>
            </div>
            <div>
              <dt className="font-mono text-caption text-muted-foreground">Id</dt>
              <dd className="font-mono text-[13px]">{email.id}</dd>
            </div>
          </dl>
        </Surface>
        <Surface>
          <h2 className="text-sm font-medium">Events</h2>
          <ol className="space-y-2 text-sm">
            {email.events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3">
                <EmailStatusBadge status={event.type} />
                <span className="text-muted-foreground">
                  {formatDateTime(event.at)}
                </span>
              </li>
            ))}
          </ol>
        </Surface>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="text">Plain text</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
        </TabsList>
      </Tabs>
      <Surface>
        {tab === "preview" ? (
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: email.html }}
          />
        ) : null}
        {tab === "text" ? (
          <pre className="font-mono text-mono whitespace-pre-wrap">{email.text}</pre>
        ) : null}
        {tab === "html" ? (
          <pre className="font-mono text-mono whitespace-pre-wrap">{email.html}</pre>
        ) : null}
      </Surface>
    </>
  )
}

export function ReceivingView() {
  const { state } = useDashboard()
  const [query, setQuery] = React.useState("")
  const receivingDomain = state.domains.find((domain) => domain.receiving)

  const rows = state.received.filter((email) => {
    const haystack = `${email.to} ${email.from} ${email.subject}`.toLowerCase()
    return !query || haystack.includes(query.trim().toLowerCase())
  })

  return (
    <>
      <PageHeader
        title="Emails"
        description="Inbound messages on domains with receiving enabled. Replay webhook events from Webhooks if an endpoint was down."
      />
      <SectionTabs items={EMAIL_TABS} />
      {receivingDomain ? (
        <p className="text-small text-muted-foreground">
          Receiving address ·{" "}
          <span className="font-mono">inbound@{receivingDomain.name}</span>
        </p>
      ) : null}
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search received…"
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={MailsIcon}
          title="No received emails"
          description="Enable receiving on a verified domain, then send a message to that address."
        />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>From</Th>
              <Th>To</Th>
              <Th>Subject</Th>
              <Th>Received</Th>
            </>
          }
        >
          {rows.map((email) => (
            <TableRow key={email.id}>
              <TableCell>
                <Link
                  href={`/emails/receiving/${email.id}`}
                  className="font-medium hover:underline"
                >
                  {email.from}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{email.to}</TableCell>
              <TableCell className="text-muted-foreground">
                {email.subject}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(email.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
    </>
  )
}

export function ReceivedDetail() {
  const { id } = useParams<{ id: string }>()
  const { state } = useDashboard()
  const email = state.received.find((item) => item.id === id)
  const [tab, setTab] = React.useState("preview")

  if (!email) {
    return (
      <EmptyState
        icon={MailsIcon}
        title="Email not found"
        description="Inbound mail may have been removed from this workspace."
      >
        <Button nativeButton={false} render={<Link href="/emails/receiving" />}>
          Back to receiving
        </Button>
      </EmptyState>
    )
  }

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="-ml-2 text-muted-foreground"
          render={<Link href="/emails/receiving" />}
        >
          <ArrowLeftIcon />
          Receiving
        </Button>
        <PageHeader title={email.subject} />
        <p className="text-small text-muted-foreground">
          {email.from} → {email.to} · {formatDateTime(email.createdAt)}
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="text">Plain text</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
        </TabsList>
      </Tabs>
      <Surface>
        {tab === "preview" ? (
          <div dangerouslySetInnerHTML={{ __html: email.html }} />
        ) : null}
        {tab === "text" ? (
          <pre className="font-mono text-mono whitespace-pre-wrap">{email.text}</pre>
        ) : null}
        {tab === "html" ? (
          <pre className="font-mono text-mono whitespace-pre-wrap">{email.html}</pre>
        ) : null}
      </Surface>
    </>
  )
}

export function SuppressionsView() {
  const { state, addSuppression, removeSuppression } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [reason, setReason] = React.useState<SuppressionReason>("manual")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)

  const rows = state.suppressions.filter((item) =>
    item.email.includes(query.trim().toLowerCase())
  )

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!isEmail(email)) {
      setError("Enter a valid email")
      return
    }
    addSuppression({ email, reason })
    toast.add({ type: "success", title: "Address suppressed" })
    setEmail("")
    setReason("manual")
    setError(null)
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Emails"
        description="Addresses that will not be sent to. Hard bounces and complaints land here automatically."
      >
        <Button onClick={() => setOpen(true)}>Add suppression</Button>
      </PageHeader>
      <SectionTabs items={EMAIL_TABS} />
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search suppressions…"
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={MailsIcon}
          title="No suppressions"
          description="Bounces and complaints will appear here. You can also add an address by hand."
        />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Email</Th>
              <Th>Reason</Th>
              <Th>Added</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.email}</TableCell>
              <TableCell className="capitalize text-muted-foreground">
                {item.reason}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(item.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <MoreMenuItem
                    variant="destructive"
                    onClick={() => setPending(item.id)}
                  >
                    Remove
                  </MoreMenuItem>
                </MoreMenu>
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
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setError(null)
                  }}
                />
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-reason">Reason</FieldLabel>
                <select
                  id="sup-reason"
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as SuppressionReason)
                  }
                  className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
                >
                  <option value="manual">Manual</option>
                  <option value="bounced">Hard bounce</option>
                  <option value="complained">Complaint</option>
                </select>
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
    </>
  )
}
