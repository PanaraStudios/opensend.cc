"use client"
import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon, ClockIcon, MessagesSquareIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { EmptyState } from "@/components/dashboard/primitives"
import { useTeamRole } from "@/components/auth/workspace"
import { actionError } from "@/lib/action-error"
import { windowLeft } from "@/lib/dashboard/conversations"
import { channelLabel } from "@/lib/dashboard/format"
import { channelHandle } from "@/lib/meta/account-display"
import { useClock } from "@/lib/time/use-clock"
import {
  useConversation,
  useConversationCommands,
  type ConversationDetail,
} from "@/lib/messages/use-messages"
import { ThreadMessages } from "./thread-messages"
import { ConversationComposer } from "./composer"

export function ConversationThread({
  id,
  onBack,
}: {
  id: string
  onBack?: () => void
}) {
  const detail = useConversation(id)
  const { canWrite } = useTeamRole()
  const { markRead, setStatus } = useConversationCommands()
  const unread = detail?.conversation.unread
  const conversationId = detail?.conversation._id
  // Opening a thread reads it; so does a reply arriving while it is open.
  React.useEffect(() => {
    if (conversationId && unread && canWrite)
      void markRead({ id: conversationId }).catch(() => undefined)
  }, [conversationId, unread, canWrite, markRead])
  React.useEffect(() => {
    const focus = () => {
      if (conversationId && unread && canWrite)
        void markRead({ id: conversationId }).catch(() => undefined)
    }
    window.addEventListener("focus", focus)
    return () => window.removeEventListener("focus", focus)
  }, [conversationId, unread, canWrite, markRead])

  if (detail === undefined) return <Skeleton className="m-4 h-40" />
  if (detail === null)
    return (
      <EmptyState
        size="sm"
        icon={MessagesSquareIcon}
        title="Conversation not found"
        description="It may belong to another team, or have been removed."
      />
    )
  const { conversation } = detail
  const closed = conversation.status === "closed"
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="conversation-thread"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background p-3">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to conversations"
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarFallback>
              {detail.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-sm font-medium">{detail.name}</h2>
            <span className="truncate text-xs text-muted-foreground">
              {detail.handle}
              {detail.account && conversation.channel !== "email"
                ? ` · ${channelLabel(conversation.channel)} ${channelHandle(conversation.channel, detail.account.handle)}`
                : ""}
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <WindowBadge conversation={conversation} />
          {detail.contact ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href={`/contacts/${detail.contact.id}`} />}
            >
              View contact
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!canWrite}
            onClick={async () => {
              try {
                await setStatus({
                  id: conversation._id,
                  status: closed ? "open" : "closed",
                })
              } catch (error) {
                toast.add({ type: "error", title: actionError(error) })
              }
            }}
          >
            {closed ? "Reopen" : "Close"}
          </Button>
        </div>
      </div>
      <ThreadMessages
        key={conversation._id}
        id={conversation._id}
        sender={detail.name}
      />
      {canWrite ? <ConversationComposer detail={detail} /> : null}
    </div>
  )
}

/** The time left in WhatsApp's customer service window. */
function WindowBadge({
  conversation,
}: {
  conversation: ConversationDetail["conversation"]
}) {
  const now = useClock()
  if (conversation.channel === "email" || now === null) return null
  const left = windowLeft(conversation.windowExpiresAt, now)
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant={left ? "success" : "secondary"} tabIndex={0} />}
      >
        <ClockIcon data-icon="inline-start" />
        {left ? `${left} left` : "Window closed"}
      </TooltipTrigger>
      <TooltipContent>
        Free-form replies are allowed for 24 hours after the customer&apos;s
        last message.{" "}
        {conversation.channel === "whatsapp"
          ? "After that, send an approved template."
          : "Wait for the customer to message you again before replying."}
      </TooltipContent>
    </Tooltip>
  )
}
