"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { DropdownMenuGroup } from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle,
  Clock,
  Copy,
  CursorClick,
  Eye,
  Inbox,
  Mail,
  Play,
  Send,
  SlashCircle,
} from "@/components/dashboard/icons"
import type { DashboardIcon } from "@/components/dashboard/icons"
import {
  EmailStatusBadge,
  EmptyState,
  MoreMenu,
  MoreMenuItem,
} from "@/components/dashboard/primitives"
import { emailStatusLabel, formatDateTime } from "@/lib/dashboard/format"
import {
  tokenizeHtml,
  type HtmlTokenKind,
} from "@/lib/dashboard/highlight-html"
import { useDashboard } from "@/lib/dashboard/store"
import type { EmailEvent, EmailStatus } from "@/lib/dashboard/types"

type TimelineEvent = {
  id: string
  at: number
  type?: EmailStatus
  label?: string
}

function EmailCopyButton({
  value,
  label = "Copy",
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    toast.add({ type: "success", title: `${label} copied` })
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

function eventIcon(event: TimelineEvent): DashboardIcon {
  if (event.label === "Received") return Inbox
  switch (event.type) {
    case "queued":
      return Play
    case "sent":
      return Send
    case "delivered":
      return CheckCircle
    case "opened":
      return Eye
    case "clicked":
      return CursorClick
    case "scheduled":
    case "delivery_delayed":
      return Clock
    case "bounced":
    case "failed":
    case "complained":
      return AlertCircle
    case "canceled":
    case "suppressed":
      return SlashCircle
    default:
      return Mail
  }
}

export function EmailDetailHeader({
  backHref,
  backLabel,
  title,
  icon: Icon = Mail,
  status,
  actions,
}: {
  backHref: string
  backLabel: string
  title: string
  icon?: DashboardIcon
  status?: EmailStatus
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        className="-ml-2 w-fit text-muted-foreground"
        render={<Link href={backHref} />}
      >
        <ArrowLeft data-icon="inline-start" />
        {backLabel}
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-tile">
            <Icon />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="title-gradient text-h3 break-all">{title}</h1>
            {status ? <EmailStatusBadge status={status} /> : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}

export function EmailMetaStrip({
  from,
  subject,
  to,
  id,
}: {
  from: string
  subject: string
  to: string
  id: string
}) {
  return (
    <ItemGroup className="flex-row flex-wrap gap-2">
      <Item size="sm" className="w-fit min-w-40 flex-1">
        <ItemContent>
          <ItemTitle>From</ItemTitle>
          <ItemDescription>{from}</ItemDescription>
        </ItemContent>
      </Item>
      <Item size="sm" className="w-fit min-w-40 flex-1">
        <ItemContent>
          <ItemTitle>Subject</ItemTitle>
          <ItemDescription>{subject}</ItemDescription>
        </ItemContent>
      </Item>
      <Item size="sm" className="w-fit min-w-40 flex-1">
        <ItemContent>
          <ItemTitle>To</ItemTitle>
          <ItemDescription>{to}</ItemDescription>
        </ItemContent>
      </Item>
      <Item size="sm" className="w-fit min-w-40 flex-1">
        <ItemContent>
          <ItemTitle>Id</ItemTitle>
          <ItemDescription className="flex items-center gap-1 font-mono">
            <span className="truncate">{id}</span>
            <EmailCopyButton value={id} label="Id" />
          </ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  )
}

export function EmailEventsRow({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {events.map((event, index) => {
        const Icon = eventIcon(event)
        return (
          <React.Fragment key={event.id}>
            {index > 0 ? (
              <Separator orientation="vertical" className="h-8 self-center" />
            ) : null}
            <Item size="xs" className="w-fit">
              <ItemMedia variant="icon">
                <Icon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {event.label ?? (event.type ? emailStatusLabel(event.type) : "Event")}
                </ItemTitle>
                <ItemDescription>{formatDateTime(event.at)}</ItemDescription>
              </ItemContent>
            </Item>
          </React.Fragment>
        )
      })}
    </div>
  )
}

const PREVIEW_HTML_CLASS =
  "text-body text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:mb-2 [&_h1]:font-heading [&_h1]:text-h4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-h4 [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-relaxed [&_p+_p]:mt-3 [&_strong]:font-medium [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"

function EmailPreview({ subject, html }: { subject: string; html: string }) {
  return (
    <article>
      <h2 className="font-heading text-h4 text-foreground">{subject}</h2>
      <div
        className={`mt-3 ${PREVIEW_HTML_CLASS}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}

const SOURCE_WELL =
  "overflow-x-auto rounded-lg bg-muted/50 p-4 font-mono text-mono whitespace-pre-wrap"

const HTML_TOKEN_CLASS: Record<HtmlTokenKind, string> = {
  text: "text-foreground",
  tag: "text-info",
  attr: "text-warning",
  string: "text-success",
  comment: "text-muted-foreground",
  punct: "text-muted-foreground",
}

function EmailSource({ value }: { value: string }) {
  return <pre className={`${SOURCE_WELL} text-foreground`}>{value}</pre>
}

function EmailHtmlSource({ value }: { value: string }) {
  const tokens = React.useMemo(() => tokenizeHtml(value), [value])

  return (
    <pre className={SOURCE_WELL}>
      {tokens.map((token, index) => (
        <span key={index} className={HTML_TOKEN_CLASS[token.kind]}>
          {token.value}
        </span>
      ))}
    </pre>
  )
}

export function EmailBodyTabs({
  from,
  to,
  subject,
  html,
  text,
  events,
  showInsights = false,
}: {
  from: string
  to: string
  subject: string
  html: string
  text: string
  events?: EmailEvent[]
  showInsights?: boolean
}) {
  const [tab, setTab] = React.useState("preview")
  const insights = (events ?? []).filter(
    (event) => event.type === "opened" || event.type === "clicked"
  )
  const raw = `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\n${text}`

  return (
    <div className="frame">
      <div className="panel overflow-hidden p-0">
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <div className="overflow-x-auto border-b border-border px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="text">Plain text</TabsTrigger>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="raw">Raw</TabsTrigger>
              {showInsights ? (
                <TabsTrigger value="insights">Insights</TabsTrigger>
              ) : null}
            </TabsList>
          </div>
          <TabsContent value="preview" className="p-5">
            <EmailPreview subject={subject} html={html} />
          </TabsContent>
          <TabsContent value="text" className="p-5">
            <EmailSource value={text} />
          </TabsContent>
          <TabsContent value="html" className="p-5">
            <EmailHtmlSource value={html} />
          </TabsContent>
          <TabsContent value="raw" className="p-5">
            <EmailSource value={raw} />
          </TabsContent>
          {showInsights ? (
            <TabsContent value="insights" className="p-5">
              {insights.length === 0 ? (
                <Empty className="min-h-40 py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="icon-tile border-0 shadow-none">
                      <Eye />
                    </EmptyMedia>
                    <EmptyTitle>No opens or clicks</EmptyTitle>
                    <EmptyDescription>
                      Tracking events will show here when the recipient opens or
                      clicks.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ItemGroup>
                  {insights.map((event) => (
                    <Item key={event.id} size="sm" variant="muted">
                      <ItemMedia variant="icon">
                        {event.type === "clicked" ? <CursorClick /> : <Eye />}
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{emailStatusLabel(event.type)}</ItemTitle>
                        <ItemDescription>
                          {formatDateTime(event.at)}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </div>
  )
}

export function EmailDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, cancelEmail, addTemplate, updateTemplate } = useDashboard()
  const email = state.emails.find((item) => item.id === id)
  const log = state.logs.find(
    (item) =>
      item.emailId === id && item.method === "POST" && item.path === "/emails"
  )

  if (!email) {
    return (
      <div className="flex flex-col gap-6">
        <EmailDetailHeader
          backHref="/emails"
          backLabel="Emails"
          title="Email not found"
        />
        <EmptyState
          icon={Mail}
          title="Email not found"
          description="It may have been pruned from this workspace."
        >
          <Button nativeButton={false} render={<Link href="/emails" />}>
            Back to emails
          </Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <EmailDetailHeader
        backHref="/emails"
        backLabel="Emails"
        title={email.to}
        status={email.status}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                const created = addTemplate({
                  name: email.subject,
                  subject: email.subject,
                })
                updateTemplate(created.id, { html: email.html })
                toast.add({ type: "success", title: "Template created" })
                router.push(`/templates/${created.id}`)
              }}
            >
              Convert to template
            </Button>
            {email.status === "scheduled" ? (
              <Button
                variant="outline"
                onClick={() => {
                  cancelEmail(email.id)
                  toast.add({ type: "success", title: "Send canceled" })
                }}
              >
                Cancel
              </Button>
            ) : null}
            <MoreMenu>
              <DropdownMenuGroup>
                <MoreMenuItem render={<Link href={`/logs?email=${email.id}`} />}>
                  View log
                </MoreMenuItem>
                <MoreMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(email.id)
                    toast.add({ type: "success", title: "Id copied" })
                  }}
                >
                  Copy id
                </MoreMenuItem>
              </DropdownMenuGroup>
            </MoreMenu>
          </>
        }
      />
      <EmailMetaStrip
        from={email.from}
        subject={email.subject}
        to={email.to}
        id={email.id}
      />
      {log ? (
        <Item
          variant="outline"
          size="sm"
          render={<Link href={`/logs?email=${email.id}`} />}
        >
          <ItemMedia variant="icon">
            <Send />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>POST /emails</ItemTitle>
            <ItemDescription>{formatDateTime(log.createdAt)}</ItemDescription>
          </ItemContent>
        </Item>
      ) : null}
      <EmailEventsRow events={email.events} />
      <EmailBodyTabs
        from={email.from}
        to={email.to}
        subject={email.subject}
        html={email.html}
        text={email.text}
        events={email.events}
        showInsights
      />
    </div>
  )
}

export function ReceivedDetail() {
  const { id } = useParams<{ id: string }>()
  const { state } = useDashboard()
  const email = state.received.find((item) => item.id === id)

  if (!email) {
    return (
      <div className="flex flex-col gap-6">
        <EmailDetailHeader
          backHref="/emails/receiving"
          backLabel="Emails"
          title="Email not found"
          icon={Inbox}
        />
        <EmptyState
          icon={Inbox}
          title="Email not found"
          description="Inbound mail may have been removed from this workspace."
        >
          <Button nativeButton={false} render={<Link href="/emails/receiving" />}>
            Back to emails
          </Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <EmailDetailHeader
        backHref="/emails/receiving"
        backLabel="Emails"
        title={email.from}
        icon={Inbox}
      />
      <EmailMetaStrip
        from={email.from}
        subject={email.subject}
        to={email.to}
        id={email.id}
      />
      <EmailEventsRow
        events={[
          {
            id: `${email.id}-received`,
            label: "Received",
            at: email.createdAt,
          },
        ]}
      />
      <EmailBodyTabs
        from={email.from}
        to={email.to}
        subject={email.subject}
        html={email.html}
        text={email.text}
      />
    </div>
  )
}
