"use client"
import * as React from "react"
import Link from "next/link"
import { ConversationImage } from "./media"
import {
  CheckIcon,
  CheckCheckIcon,
  ClockIcon,
  CircleAlertIcon,
  ForwardIcon,
} from "lucide-react"
import {
  Bubble,
  BubbleContent,
  BubbleMeta,
  BubbleReactions,
} from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { MediaViewerProvider } from "@/components/ui/media-viewer"
import { conversationMedia } from "@/lib/dashboard/conversation-media"
import { MessageFiles } from "@/components/dashboard/emails/shared"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import { messageHref } from "@/lib/messages/links"
import { useThread, type ThreadMessage } from "@/lib/messages/use-messages"
import { object, string } from "@/lib/meta/parse"
import {
  chatDay,
  sameMessageGroup,
  safeMessageUrl,
} from "@/lib/dashboard/conversation-content"
import { formatDateTime, sentenceCase } from "@/lib/dashboard/format"
import { useClock } from "@/lib/time/use-clock"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"
import { NormalizedMessageContent, ReferralCard } from "./message-content"

export function ThreadMessages({
  id,
  sender = "Contact",
}: {
  id: Id<"conversations">
  sender?: string
}) {
  const thread = useThread(id)
  const now = useClock()
  if (thread.status === "LoadingFirstPage")
    return <Skeleton className="m-4 min-h-0 flex-1" />
  const visible = thread.messages.filter(
    (message) => message.normalized?.type !== "reaction"
  )
  const originals = new Map(
    visible.flatMap((message) =>
      message.normalized?.external_id
        ? [[message.normalized.external_id, message] as const]
        : []
    )
  )
  return (
    <MediaViewerProvider items={conversationMedia(visible, sender)}>
      <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
        <MessageScroller className="min-h-0 flex-1 bg-background">
          <MessageScrollerViewport preserveScrollOnPrepend>
            <MessageScrollerContent className="gap-1 px-4 py-5 sm:px-8">
              <LoadOlder
                canLoad={thread.status === "CanLoadMore"}
                onLoad={thread.loadOlder}
              />
              {visible.map((message, i) => {
                const previous = visible[i - 1]
                const date =
                  !previous ||
                  new Date(previous.at).toDateString() !==
                    new Date(message.at).toDateString()
                const context = object(message.normalized?.context)
                const reply = originals.get(
                  string(context.id) || string(context.message_id)
                )
                return (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    {date ? (
                      <div className="my-3 flex justify-center">
                        <Badge variant="secondary">
                          {chatDay(message.at, now ?? message.at)}
                        </Badge>
                      </div>
                    ) : null}
                    <ThreadBubble
                      message={message}
                      grouped={sameMessageGroup(previous, message)}
                      reply={reply}
                    />
                  </MessageScrollerItem>
                )
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </MediaViewerProvider>
  )
}
function LoadOlder({
  canLoad,
  onLoad,
}: {
  canLoad: boolean
  onLoad: () => void
}) {
  const scrollable = useMessageScrollerScrollable()
  React.useEffect(() => {
    if (canLoad && !scrollable.start) onLoad()
  }, [canLoad, scrollable.start, onLoad])
  return null
}
export function ThreadBubble({
  message,
  grouped = false,
  reply,
}: {
  message: ThreadMessage
  grouped?: boolean
  reply?: ThreadMessage
}) {
  const data = message.normalized
  if (data?.type === "reaction") return null
  const outbound = message.direction === "outbound"
  const sticker = data?.type === "sticker"
  const audio = data?.type === "audio"
  const context = object(data?.context)
  if (data?.type === "system" || data?.type === "unsupported") {
    const content = object(data.content)
    const poll = string(content.type).startsWith("poll")
    return (
      <div className="my-3 flex justify-center" data-testid="thread-message">
        <Badge
          variant="secondary"
          className="h-auto max-w-full text-center whitespace-normal"
        >
          {data.type === "system"
            ? string(content.body) || message.text
            : poll
              ? "Poll · Polls aren't supported by the WhatsApp Cloud API"
              : "This message type isn't supported yet"}
        </Badge>
      </div>
    )
  }
  const StatusIcon =
    message.error || ["failed", "bounced"].includes(message.status)
      ? CircleAlertIcon
      : ["read", "played", "delivered", "opened", "clicked"].includes(
            message.status
          )
        ? CheckCheckIcon
        : message.status === "sent"
          ? CheckIcon
          : ClockIcon
  return (
    <Message
      align={outbound ? "end" : "start"}
      data-testid="thread-message"
      id={`chat-message-${message.id}`}
      className={cn(!grouped && "mt-2", data?.reactions?.length && "mb-4")}
    >
      <MessageContent>
        {message.subject ? (
          <p className="text-xs font-medium">{message.subject}</p>
        ) : null}
        <Bubble
          align={outbound ? "end" : "start"}
          variant={
            sticker
              ? "ghost"
              : message.error
                ? "destructive"
                : outbound
                  ? "default"
                  : "muted"
          }
          className={cn(
            "max-w-[min(85%,36rem)]",
            audio && "@container/audio w-90"
          )}
        >
          <BubbleContent
            className={cn(
              audio && "w-full",
              audio &&
                outbound &&
                "[&_[role=slider]]:[--foreground:var(--primary-foreground)]"
            )}
          >
            {context.forwarded || context.frequently_forwarded ? (
              <p className="mb-1 flex items-center gap-1 text-xs italic opacity-60">
                <ForwardIcon className="size-3 shrink-0" />
                {context.frequently_forwarded
                  ? "Forwarded many times"
                  : "Forwarded"}
              </p>
            ) : null}
            {context.id || context.message_id ? (
              <a
                className="mb-2 block rounded-md border-l-4 border-current bg-background/10 p-2"
                href={reply ? `#chat-message-${reply.id}` : undefined}
                onClick={(event) => {
                  if (reply) {
                    event.preventDefault()
                    document
                      .getElementById(`chat-message-${reply.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                }}
              >
                {reply?.normalized?.type === "image" &&
                safeMessageUrl(
                  reply.normalized.attachments[0]?.download_url
                ) ? (
                  <ConversationImage
                    src={reply.normalized.attachments[0].download_url!}
                    alt="Quoted photo"
                    width={40}
                    height={40}
                    className="float-right ml-2 size-10 rounded object-cover"
                  />
                ) : null}
                <strong className="block text-xs">
                  {string(context.from) || "Reply"}
                </strong>
                <span className="line-clamp-2 text-xs">
                  {reply?.text || "Original message"}
                </span>
              </a>
            ) : null}
            <ReferralCard message={message} />
            <div
              className={cn(
                audio ? "flex flex-wrap items-end gap-x-2" : "contents"
              )}
            >
              <div
                className={cn(audio ? "min-w-0 flex-[1_1_200px]" : "contents")}
              >
                {data ? (
                  <NormalizedMessageContent message={message} />
                ) : message.rendered ? (
                  <WhatsAppTemplatePreview
                    rendered={message.rendered}
                    embedded
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{message.text}</span>
                )}
                {!data && message.media.length ? (
                  <MessageFiles messageId={message.id} media={message.media} />
                ) : null}
              </div>
              <BubbleMeta
                className={cn(
                  audio && "ml-auto shrink-0 self-end",
                  audio &&
                    (outbound
                      ? "@min-[19rem]/audio:mb-1.5"
                      : "@min-[17.5rem]/audio:mb-1.5")
                )}
              >
                <Link
                  href={messageHref(message.kind, message.id)}
                  title={formatDateTime(message.at)}
                >
                  {new Date(message.at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Link>
                {outbound ? (
                  <span
                    data-testid="message-status"
                    className={cn(
                      "inline-flex",
                      ["read", "played"].includes(message.status) &&
                        "text-info",
                      message.error && "text-destructive"
                    )}
                    title={sentenceCase(message.status)}
                  >
                    <StatusIcon className="size-3.5" />
                    <span className="sr-only">
                      {sentenceCase(message.status)}
                    </span>
                  </span>
                ) : null}
              </BubbleMeta>
            </div>
            {message.error ? (
              <p className="mt-1 text-xs text-destructive">{message.error}</p>
            ) : null}
          </BubbleContent>
          {data?.reactions?.length ? (
            <BubbleReactions aria-label="Reactions">
              {data.reactions.map((reaction) => (
                <span key={reaction.id} title={reaction.from}>
                  {reaction.emoji}
                </span>
              ))}
            </BubbleReactions>
          ) : null}
        </Bubble>
      </MessageContent>
    </Message>
  )
}
