"use client"
import { SendMessageAction } from "../conversation/send-message-action"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { channelIcon } from "@/components/dashboard/channels/shared"
import type { ConversationItem } from "@/lib/messages/use-messages"
import { DownloadIcon, FileIcon } from "lucide-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import { useMediaDownload, type MediaFile } from "@/lib/messages/use-messages"

import {
  SectionChrome,
  RelativeTime,
  channelMessageStatusDotClassName,
  emailStatusDotClassName,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  emailStatusLabel,
  sentenceCase,
  suppressionReasonLabel,
} from "@/lib/dashboard/format"
import { EMAIL_TABS } from "@/lib/dashboard/nav"
import type {
  ChannelMessageStatus,
  EmailStatus,
  SuppressionReason,
} from "@/lib/dashboard/types"

export { defaultEmailRange } from "@/lib/dashboard/email-range"

const FILTERABLE_STATUSES: EmailStatus[] = [
  "delivered",
  "opened",
  "clicked",
  "sent",
  "scheduled",
  "bounced",
  "failed",
  "canceled",
  "suppressed",
]

export function isFilterableStatus(value: string): value is EmailStatus {
  return (FILTERABLE_STATUSES as string[]).includes(value)
}

export const STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses", dotClassName: "bg-muted-foreground" },
  ...FILTERABLE_STATUSES.map((value) => ({
    value,
    label: emailStatusLabel(value),
    dotClassName: emailStatusDotClassName(value),
  })),
]

/** A sent WhatsApp message's statuses; `read` is the one email lacks. */
const CHANNEL_STATUSES: ChannelMessageStatus[] = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
]
const channelStatusItem = (value: ChannelMessageStatus): SelectOption => ({
  value,
  label: sentenceCase(value),
  dotClassName: channelMessageStatusDotClassName(value),
})

/** The Sending log's status filter for a channel filter value. All
    channels offer email's statuses plus `read`; a status filters each
    channel that has it. */
export function sendingStatusItems(channel: string): readonly SelectOption[] {
  if (channel === "email") return STATUS_ITEMS
  if (channel === "whatsapp")
    return [STATUS_ITEMS[0], ...CHANNEL_STATUSES.map(channelStatusItem)]
  return [...STATUS_ITEMS, channelStatusItem("read")]
}

export function sendingStatus(
  value: string
): EmailStatus | ChannelMessageStatus | undefined {
  return isFilterableStatus(value) ||
    (CHANNEL_STATUSES as string[]).includes(value)
    ? (value as EmailStatus | ChannelMessageStatus)
    : undefined
}

/** A channel filter value as the logs take it; "all" is no filter. */
export function logChannel(value: string): "email" | "whatsapp" | undefined {
  return value === "email" || value === "whatsapp" ? value : undefined
}

const SUPPRESSION_REASONS: SuppressionReason[] = [
  "manual",
  "bounced",
  "complained",
]

function reasonItem(value: SuppressionReason): SelectOption {
  return { value, label: suppressionReasonLabel(value) }
}

export const REASON_ITEMS: readonly SelectOption[] =
  SUPPRESSION_REASONS.map(reasonItem)

export const ORIGIN_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All origins" },
  reasonItem("bounced"),
  reasonItem("complained"),
  reasonItem("manual"),
]

export function isSuppressionReason(value: string): value is SuppressionReason {
  return (SUPPRESSION_REASONS as string[]).includes(value)
}

export function EmailsChrome({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <SectionChrome
      title="Messages"
      tabs={EMAIL_TABS}
      actions={
        <>
          <SendMessageAction />
          {actions}
        </>
      }
    >
      {children}
    </SectionChrome>
  )
}

/** A message's files: each downloads once it is stored, and one Meta
    could not hand over says why. */
export function MessageFiles({
  messageId,
  media,
}: {
  messageId: string
  media: readonly MediaFile[]
}) {
  const download = useMediaDownload()
  return (
    <AttachmentGroup>
      {media.map((file, index) => (
        <Attachment
          key={file.mediaId ?? index}
          size="sm"
          state={file.error ? "error" : file.ready ? "done" : "processing"}
        >
          <AttachmentMedia>
            <FileIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>
              {file.filename ?? file.contentType}
            </AttachmentTitle>
            <AttachmentDescription>
              {file.error ?? file.contentType}
            </AttachmentDescription>
          </AttachmentContent>
          {file.ready && file.mediaId ? (
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Download ${file.filename ?? "file"}`}
                onClick={async () => {
                  try {
                    await download(messageId, file.mediaId!)
                  } catch (error) {
                    toast.add({ type: "error", title: actionError(error) })
                  }
                }}
              >
                <DownloadIcon />
              </AttachmentAction>
            </AttachmentActions>
          ) : null}
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}

/** A conversation's preview row, shared by Inbox and contact history. */
export function ConversationRow({
  conversation,
  title,
  render,
  selected = false,
}: {
  conversation: ConversationItem["conversation"]
  title: string
  render: React.ReactElement
  selected?: boolean
}) {
  return (
    <Item
      size="sm"
      variant={selected ? "muted" : "default"}
      aria-current={selected || undefined}
      render={render}
      data-testid="conversation"
    >
      <ItemMedia variant="icon">
        {React.createElement(channelIcon(conversation.channel))}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="line-clamp-1">
          {conversation.lastDirection === "outbound" ? "You: " : ""}
          {conversation.lastPreview}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1 self-start">
        <span className="text-xs text-muted-foreground">
          <RelativeTime at={conversation.lastMessageAt} />
        </span>
        {conversation.unread ? (
          <Badge variant="primary" aria-label="Unread">
            {conversation.unreadCount || 1}
          </Badge>
        ) : null}
      </ItemActions>
    </Item>
  )
}
