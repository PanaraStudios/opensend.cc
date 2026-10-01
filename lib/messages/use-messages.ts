"use client"
import * as React from "react"
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import type { ThreadMessage } from "@/convex/conversations"
import { useTeamList } from "@/components/dashboard/primitives"
import { useTeamQuery } from "@/components/auth/workspace"
import { sendableStatus } from "@/lib/meta/templates"
import { asEmail } from "@/lib/emails/use-emails"
import { asReceived } from "@/lib/received/use-received"
import type {
  Channel,
  ChannelMessageStatus,
  EmailStatus,
} from "@/lib/dashboard/types"

/** One row of the Sending or Receiving log, on any channel. */
export type LogRow = {
  id: string
  channel: Channel
  href: string
  /** Who it went to (Sending) or came from (Receiving). */
  party: string
  /** The subject, or the message's preview. */
  summary: string
  /** Where a received message arrived. */
  to: string
  status:
    | { kind: "email"; value: EmailStatus }
    | { kind: "channel"; value: ChannelMessageStatus }
    | null
  createdAt: number
}

/** A phone number as WhatsApp's wa_id gives it, without the plus. */
const phone = (value: string) => (value.startsWith("+") ? value : `+${value}`)

function channelRow(message: Doc<"channelMessages">, to = ""): LogRow {
  const outbound = message.direction === "outbound"
  return {
    id: message._id,
    channel: message.channel,
    href: `/emails/messages/${message._id}`,
    party: phone(outbound ? message.to : message.from),
    summary: message.preview,
    to,
    status: { kind: "channel", value: message.status },
    createdAt: message._creationTime,
  }
}

type SentItem = FunctionReturnType<typeof api.messages.sending>["page"][number]
function asSentRow(item: SentItem): LogRow {
  if (item.kind === "channel") return channelRow(item.message)
  const email = asEmail(item.email)
  return {
    id: email.id,
    channel: "email",
    href: `/emails/${email.id}`,
    party: email.to,
    summary: email.subject,
    to: email.to,
    status: { kind: "email", value: email.status },
    createdAt: email.createdAt,
  }
}

type ReceivedItem = FunctionReturnType<
  typeof api.messages.receiving
>["page"][number]
function asReceivedRow(item: ReceivedItem): LogRow {
  if (item.kind === "channel") return channelRow(item.message, item.account)
  const email = asReceived(item.email)
  return {
    id: email.id,
    channel: "email",
    href: `/emails/receiving/${email.id}`,
    party: email.from,
    summary: email.subject,
    to: email.to,
    status: null,
    createdAt: email.createdAt,
  }
}

type LogFilters = {
  channel?: "email" | "whatsapp"
  search?: string
  from?: number
  to?: number
}

/** Sent email and channel messages, newest first, merged across channels
    unless `channel` picks one. */
export function useSendingLog(
  filters: LogFilters & { status?: EmailStatus | ChannelMessageStatus }
) {
  return useTeamList(
    api.messages.sending,
    api.messages.sendingCount,
    filters,
    asSentRow
  )
}

/** Received email and inbound channel messages, the same way. */
export function useReceivingLog(filters: LogFilters) {
  return useTeamList(
    api.messages.receiving,
    api.messages.receivingCount,
    filters,
    asReceivedRow
  )
}

/** A channel message with its body and timeline; undefined while loading,
    null when there is no such message. */
export function useChannelMessage(id: string | undefined) {
  return useQuery(api.messages.get, id ? { id } : "skip")
}

/** Opens a signed download link for one of a message's files. */
export function useMediaDownload() {
  const link = useAction(api.messages.mediaLink)
  return async (messageId: string, mediaId: string) => {
    window.open(await link({ messageId, mediaId }), "_blank", "noopener")
  }
}

/* ---------------------------------------------------------------- inbox */

export type ConversationItem = FunctionReturnType<
  typeof api.conversations.list
>["page"][number]
export type ConversationDetail = NonNullable<
  FunctionReturnType<typeof api.conversations.get>
>
export type { ThreadMessage }
export type MediaFile = ThreadMessage["media"][number]

export function useConversationList(filters: {
  channel?: Channel
  status?: "open" | "closed"
  unread?: boolean
  search?: string
}) {
  return useTeamList(api.conversations.list, api.conversations.count, filters)
}

export function useConversation(id: string | null) {
  return useQuery(api.conversations.get, id ? { id } : "skip")
}

/** Email bodies come with the thread, so it loads a few at a time. */
const THREAD_PAGE = 10

/** A thread's messages oldest first, loading older ones on demand. */
export function useThread(id: Id<"conversations"> | undefined) {
  const query = usePaginatedQuery(
    api.conversations.messages,
    id ? { id } : "skip",
    { initialNumItems: THREAD_PAGE }
  )
  const messages = React.useMemo(
    () => [...query.results].reverse(),
    [query.results]
  )
  return {
    messages,
    status: query.status,
    loadOlder: () => query.loadMore(THREAD_PAGE),
  }
}

/** The team's WhatsApp templates Meta approved for one WABA, newest
    first, narrowed by `search`. */
export function useApprovedTemplates(
  wabaId: string | null | undefined,
  search: string
) {
  const rows = useTeamQuery(
    api.templates.options,
    { channel: "whatsapp", search },
    { enabled: !!wabaId }
  )
  return React.useMemo(
    () =>
      (rows ?? []).filter(
        (row) =>
          row.whatsapp?.wabaId === wabaId &&
          sendableStatus(row.whatsapp?.metaStatus)
      ),
    [rows, wabaId]
  )
}

/** The approved template's variables on this thread's number. */
export function useTemplateVariables(
  id: Id<"conversations"> | undefined,
  templateId: string | undefined
) {
  return useQuery(
    api.conversations.templateVariables,
    id && templateId
      ? { id, templateId: templateId as Id<"templates"> }
      : "skip"
  )
}

export function useConversationCommands() {
  const markRead = useMutation(api.conversations.markRead)
  const setStatus = useMutation(api.conversations.setStatus)
  const reply = useMutation(api.conversations.reply)
  return { markRead, setStatus, reply }
}
