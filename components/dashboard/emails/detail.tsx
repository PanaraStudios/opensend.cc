"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { TabsContent } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  InboxIcon,
  MailIcon,
  MousePointerClickIcon,
  PlayIcon,
  ScrollTextIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react"
import {
  CodeWell,
  CopyButton,
  DetailHeader,
  EmailStatusBadge,
  EmptyState,
  EventTrail,
  MetaStrip,
  MoreMenu,
  NotFoundState,
  PanelTabs,
  copyToClipboard,
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

function eventIcon(event: TimelineEvent): LucideIcon {
  if (event.label === "Received") return InboxIcon
  switch (event.type) {
    case "queued":
      return PlayIcon
    case "sent":
      return SendIcon
    case "delivered":
      return CircleCheckIcon
    case "opened":
      return EyeIcon
    case "clicked":
      return MousePointerClickIcon
    case "scheduled":
    case "delivery_delayed":
      return ClockIcon
    case "bounced":
    case "failed":
    case "complained":
      return CircleAlertIcon
    case "canceled":
    case "suppressed":
      return CircleSlashIcon
    default:
      return MailIcon
  }
}

function emailMeta(email: {
  from: string
  subject: string
  to: string
  id: string
}) {
  return [
    { label: "From", value: email.from },
    { label: "Subject", value: email.subject },
    { label: "To", value: email.to },
    {
      label: "Id",
      value: (
        <>
          <span className="truncate font-mono">{email.id}</span>
          <CopyButton value={email.id} label="Id" />
        </>
      ),
    },
  ]
}

function EmailEventsRow({ events }: { events: TimelineEvent[] }) {
  return (
    <EventTrail
      steps={events.map((event) => ({
        id: event.id,
        icon: eventIcon(event),
        label:
          event.label ?? (event.type ? emailStatusLabel(event.type) : "Event"),
        caption: formatDateTime(event.at),
      }))}
    />
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

const HTML_TOKEN_CLASS: Record<HtmlTokenKind, string> = {
  text: "text-foreground",
  tag: "text-info",
  attr: "text-warning",
  string: "text-success",
  comment: "text-muted-foreground",
  punct: "text-muted-foreground",
}

function EmailSource({ value }: { value: string }) {
  return <CodeWell className="text-foreground">{value}</CodeWell>
}

function EmailHtmlSource({ value }: { value: string }) {
  const tokens = React.useMemo(() => tokenizeHtml(value), [value])

  return (
    <CodeWell>
      {tokens.map((token, index) => (
        <span key={index} className={HTML_TOKEN_CLASS[token.kind]}>
          {token.value}
        </span>
      ))}
    </CodeWell>
  )
}

function EmailBodyTabs({
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
  const tabs = [
    { value: "preview", label: "Preview" },
    { value: "text", label: "Plain text" },
    { value: "html", label: "HTML" },
    { value: "raw", label: "Raw" },
    ...(showInsights ? [{ value: "insights", label: "Insights" }] : []),
  ]

  return (
    <PanelTabs value={tab} onValueChange={setTab} tabs={tabs}>
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
            <EmptyState
              size="sm"
              icon={EyeIcon}
              title="No opens or clicks"
              description="Tracking events will show here when the recipient opens or clicks."
            />
          ) : (
            <ItemGroup>
              {insights.map((event) => (
                <Item key={event.id} size="sm" variant="muted">
                  <ItemMedia variant="icon">
                    {event.type === "clicked" ? (
                      <MousePointerClickIcon />
                    ) : (
                      <EyeIcon />
                    )}
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
    </PanelTabs>
  )
}

export function EmailDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, cancelEmail, addTemplate } = useDashboard()
  const email = state.emails.find((item) => item.id === id)
  const log = state.logs.find(
    (item) =>
      item.emailId === id && item.method === "POST" && item.path === "/emails"
  )

  if (!email) {
    return (
      <NotFoundState
        icon={MailIcon}
        noun="email"
        backHref="/emails"
        description="It may have been pruned from this workspace."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/emails"
        backLabel="Emails"
        title={email.to}
        icon={MailIcon}
        badge={<EmailStatusBadge status={email.status} />}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                const created = addTemplate({
                  name: email.subject,
                  subject: email.subject,
                  html: email.html,
                })
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
                <DropdownMenuItem
                  render={<Link href={`/logs?email=${email.id}`} />}
                >
                  <ScrollTextIcon />
                  View log
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void copyToClipboard(email.id, "Id")}
                >
                  <CopyIcon />
                  Copy id
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </MoreMenu>
          </>
        }
      />
      <MetaStrip items={emailMeta(email)} />
      {log ? (
        <Item
          variant="outline"
          size="sm"
          render={<Link href={`/logs/${log.id}`} />}
        >
          <ItemMedia variant="icon">
            <SendIcon />
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
      <NotFoundState
        icon={InboxIcon}
        noun="email"
        backHref="/emails/receiving"
        description="Inbound mail may have been removed from this workspace."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/emails/receiving"
        backLabel="Emails"
        title={email.from}
        icon={InboxIcon}
      />
      <MetaStrip items={emailMeta(email)} />
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
