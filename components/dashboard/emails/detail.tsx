"use client"
import { fromWaId } from "@/lib/dashboard/phone"

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
import { Skeleton } from "@/components/ui/skeleton"
import { TabsContent } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  CheckCheckIcon,
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
  ShareIcon,
  type LucideIcon,
} from "lucide-react"
import {
  ChannelMessageStatusBadge,
  CodeWell,
  CopyButton,
  DetailHeader,
  JsonSection,
  MonoLink,
  EmailStatusBadge,
  EmptyState,
  EventTrail,
  MetaStrip,
  ListPagination,
  MoreMenu,
  NotFoundState,
  PanelTabs,
  copyToClipboard,
} from "@/components/dashboard/primitives"
import {
  emailStatusLabel,
  formatDateTime,
  sentenceCase,
} from "@/lib/dashboard/format"
import {
  tokenizeHtml,
  type HtmlTokenKind,
} from "@/lib/dashboard/highlight-html"
import { actionError } from "@/lib/action-error"
import { useReceived } from "@/lib/received/use-received"
import type {
  ChannelMessageStatus,
  EmailEvent,
  EmailStatus,
} from "@/lib/dashboard/types"
import {
  useEmail,
  useEmailCommands,
  useEmailEvents,
} from "@/lib/emails/use-emails"
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import { useSaveAsTemplate } from "@/lib/templates/use-templates"
import { useChannelMessage } from "@/lib/messages/use-messages"
import { channelIcon } from "@/components/dashboard/channels/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { useShareEmail } from "./share-dialog"
import { MessageFiles } from "./shared"

type TimelineEvent = {
  id: string
  at: number
  type?: EmailStatus | ChannelMessageStatus | "payment_updated"
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
    case "read":
      return CheckCheckIcon
    case "received":
      return InboxIcon
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

function eventLabel(type: TimelineEvent["type"]) {
  if (!type) return "Event"
  // Only channel messages are read, or received as events.
  return type === "read" ||
    type === "played" ||
    type === "payment_updated" ||
    type === "received"
    ? sentenceCase(type)
    : emailStatusLabel(type)
}

function EmailEventsRow({ events }: { events: TimelineEvent[] }) {
  return (
    <EventTrail
      steps={events.map((event) => ({
        id: event.id,
        icon: eventIcon(event),
        label: event.label ?? eventLabel(event.type),
        caption: formatDateTime(event.at),
      }))}
    />
  )
}

function EmailPreview({ subject, html }: { subject: string; html: string }) {
  return (
    <article>
      <h2 className="font-heading text-h4 text-foreground">{subject}</h2>
      <EmailPreviewFrame html={html} title={subject} className="mt-3 h-96" />
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
  emailId,
}: {
  from: string
  to: string
  subject: string
  html: string
  text: string
  events?: EmailEvent[]
  showInsights?: boolean
  emailId?: string
}) {
  const [tab, setTab] = React.useState("preview")
  const insightPage = useEmailEvents(emailId, true)
  const insights = emailId
    ? insightPage.pageRows
    : (events ?? []).filter(
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
          {emailId ? (
            <ListPagination {...insightPage.pagination} embedded noun="event" />
          ) : null}
        </TabsContent>
      ) : null}
    </PanelTabs>
  )
}

export function EmailDetail() {
  const { id } = useParams<{ id: string }>()
  const share = useShareEmail(id)
  const router = useRouter()
  const { cancelEmail } = useEmailCommands()
  const saveAsTemplate = useSaveAsTemplate()
  const found = useEmail(id)
  const timeline = useEmailEvents(found?.email.id)

  if (found === undefined) return <Skeleton className="h-64 w-full" />
  if (!found) {
    return (
      <NotFoundState
        icon={MailIcon}
        noun="email"
        backHref="/emails"
        description="It may have been pruned from this workspace."
      />
    )
  }

  const { email, log } = found
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/emails"
        backLabel="Messages"
        title={email.to}
        icon={MailIcon}
        badge={<EmailStatusBadge status={email.status} />}
        actions={
          <>
            <Button
              variant="outline"
              onClick={async () => {
                const id = await saveAsTemplate({
                  name: email.subject,
                  subject: email.subject,
                  html: email.html,
                })
                if (id) router.push(`/templates/${id}`)
              }}
            >
              Convert to template
            </Button>
            {email.status === "scheduled" ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await cancelEmail(email.id)
                    toast.add({ type: "success", title: "Send canceled" })
                  } catch (e) {
                    toast.add({ type: "error", title: actionError(e) })
                  }
                }}
              >
                Cancel
              </Button>
            ) : null}
            <MoreMenu>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={!share.canWrite}
                  onClick={share.open}
                >
                  <ShareIcon />
                  Share email
                </DropdownMenuItem>
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
      {share.dialog}
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
      <EmailEventsRow events={timeline.pageRows} />
      <ListPagination {...timeline.pagination} embedded noun="event" />
      <EmailBodyTabs
        from={email.from}
        to={email.to}
        subject={email.subject}
        html={email.html}
        text={email.text}
        emailId={email.id}
        showInsights
      />
    </div>
  )
}

export function ReceivedDetail() {
  const { id } = useParams<{ id: string }>()
  const share = useShareEmail(id)
  const email = useReceived(id)

  if (email === undefined) return <Skeleton className="h-64 w-full" />

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
        backLabel="Messages"
        title={email.from}
        icon={InboxIcon}
        actions={
          <MoreMenu>
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!share.canWrite} onClick={share.open}>
                <ShareIcon />
                Share email
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </MoreMenu>
        }
      />
      {share.dialog}
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

/** A WhatsApp (later Messenger, Instagram) message: who, what, its
    timeline and the payload Meta got or sent. */
export function ChannelMessageDetail() {
  const { id } = useParams<{ id: string }>()
  const found = useChannelMessage(id)

  if (found === undefined) return <Skeleton className="h-64 w-full" />
  if (!found) {
    return (
      <NotFoundState
        icon={MailIcon}
        noun="message"
        backHref="/emails"
        description="Messages are pruned from this workspace after 7 days."
      />
    )
  }

  const { message, account, events } = found
  const inbound = message.direction === "inbound"
  const number = account?.handle ?? message.from
  const person =
    message.channel === "whatsapp"
      ? fromWaId(inbound ? message.from : message.to)
      : inbound
        ? message.from
        : message.to
  const payload: unknown = JSON.parse(found.payload)
  const template =
    message.type === "template" &&
    typeof payload === "object" &&
    payload !== null &&
    "template" in payload
      ? (payload.template as { name?: string }).name
      : undefined
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref={inbound ? "/emails/receiving" : "/emails"}
        backLabel="Messages"
        title={person}
        icon={channelIcon(message.channel)}
        badge={<ChannelMessageStatusBadge status={message.status} />}
        actions={
          <MoreMenu>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => void copyToClipboard(message._id, "Id")}
              >
                <CopyIcon />
                Copy id
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </MoreMenu>
        }
      />
      <MetaStrip
        items={[
          { label: "From", value: inbound ? person : number },
          { label: "To", value: inbound ? number : person },
          {
            label: template ? "Template" : "Type",
            value: template ?? sentenceCase(message.type),
          },
          {
            label: "Conversation",
            value: (
              <MonoLink href={`/emails/inbox?c=${message.conversationId}`}>
                Open in Inbox
              </MonoLink>
            ),
          },
          {
            label: "Id",
            value: (
              <>
                <span className="truncate font-mono">{message._id}</span>
                <CopyButton value={message._id} label="Id" />
              </>
            ),
          },
        ]}
      />
      {message.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {message.errorTitle ?? "Meta refused the message"}
            {message.errorCode ? ` (${message.errorCode})` : ""}
          </AlertTitle>
          <AlertDescription>{message.error}</AlertDescription>
        </Alert>
      ) : null}
      <EmailEventsRow
        events={events.map((event) => ({
          id: event._id,
          type: event.type,
          at: event.at,
        }))}
      />
      {found.media.length ? (
        <MessageFiles messageId={message._id} media={found.media} />
      ) : null}
      {found.rendered ? (
        <WhatsAppTemplatePreview rendered={found.rendered} />
      ) : null}
      <JsonSection title="Payload" value={payload} />
    </div>
  )
}
