"use client"

import type { EmailStatus } from "@/lib/dashboard/types"
import * as React from "react"
import { messageHref, threadHref } from "@/lib/messages/links"
import { channelHandle } from "@/lib/meta/account-display"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeftIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  InboxIcon,
  MessagesSquareIcon,
  SendIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { ItemGroup } from "@/components/ui/item"
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DocsButton,
  EmptyState,
  IconCell,
  ListPagination,
  ListToolbar,
  OptionSelect,
  RelativeTime,
  useListSearch,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  MESSAGE_CHANNEL_ITEMS,
  channelIcon,
} from "@/components/dashboard/channels/shared"
import {
  EmailsChrome,
  ConversationRow,
  MessageFiles,
  logChannel,
} from "@/components/dashboard/emails/shared"
import { useTeamRole } from "@/components/auth/workspace"
import { useIsMobile } from "@/hooks/use-mobile"
import { actionError } from "@/lib/action-error"
import {
  canReply,
  replySender,
  windowLeft,
} from "@/lib/dashboard/conversations"
import {
  channelLabel,
  defaultFromAddress,
  formatDateTime,
  sentenceCase,
  emailStatusLabel,
} from "@/lib/dashboard/format"
import { useDomainOptions } from "@/lib/domains/use-domains"
import { senderDomainSearch } from "@/lib/dashboard/sender-options"
import { useClock } from "@/lib/time/use-clock"
import { cn } from "@/lib/utils"
import {
  useApprovedTemplates,
  useConversation,
  useConversationCommands,
  useConversationList,
  useTemplateVariables,
  useThread,
  type ConversationDetail,
  type ThreadMessage,
} from "@/lib/messages/use-messages"
import type { Id } from "@/convex/_generated/dataModel"

const STATE_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All conversations" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "unread", label: "Unread" },
]

/** Every channel's threads: the list on the left, the open one on the
    right. The open thread is in the URL (`?c=`), so it can be linked. */
export function InboxView() {
  const router = useRouter()
  const selected = useSearchParams().get("c")
  const mobile = useIsMobile()
  const list = <ConversationList selected={selected} />
  const thread = selected ? (
    <ConversationThread
      key={selected}
      id={selected}
      onBack={
        mobile
          ? () => router.replace(threadHref(null), { scroll: false })
          : undefined
      }
    />
  ) : (
    <EmptyState
      size="sm"
      icon={MessagesSquareIcon}
      title="No conversation selected"
      description="Choose a conversation to read it and reply."
    />
  )
  return (
    <EmailsChrome actions={<DocsButton />}>
      <div className="frame">
        <div className="panel overflow-hidden p-0">
          {mobile ? (
            <div className="flex h-[calc(100svh-14rem)] min-h-96 flex-col">
              {selected ? thread : list}
            </div>
          ) : (
            <ResizablePanelGroup
              orientation="horizontal"
              className="h-[calc(100svh-14rem)] min-h-96"
            >
              <ResizablePanel defaultSize="36" minSize="25">
                {list}
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize="64" minSize="40">
                <div className="flex h-full min-h-0 flex-col">{thread}</div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </div>
    </EmailsChrome>
  )
}

function ConversationList({ selected }: { selected: string | null }) {
  const { query, setQuery, search } = useListSearch()
  const [channel, setChannel] = React.useState("all")
  const [state, setState] = React.useState("all")
  const conversations = useConversationList({
    channel: logChannel(channel),
    status: state === "open" || state === "closed" ? state : undefined,
    unread: state === "unread" ? true : undefined,
    search: search.trim() || undefined,
  })
  const { rows, pageRows, pagination } = conversations

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search conversations…"
          filters={[
            {
              value: channel,
              onChange: setChannel,
              items: MESSAGE_CHANNEL_ITEMS,
              "aria-label": "Filter by channel",
            },
            {
              value: state,
              onChange: setState,
              items: STATE_ITEMS,
              "aria-label": "Filter by status",
            },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.status === "LoadingFirstPage" ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            icon={InboxIcon}
            title="No conversations"
            description="Connect a channel to receive messages and start conversations here."
          >
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/channels" />}
            >
              Connect a channel
            </Button>
          </EmptyState>
        ) : (
          <ItemGroup className="gap-1">
            {pageRows.map(({ conversation, name }) => (
              <ConversationRow
                key={conversation._id}
                conversation={conversation}
                title={name}
                selected={conversation._id === selected}
                render={
                  <Link
                    href={threadHref(conversation._id)}
                    replace
                    scroll={false}
                  />
                }
              />
            ))}
          </ItemGroup>
        )}
        <ListPagination {...pagination} embedded noun="conversation" />
      </div>
    </div>
  )
}

function ConversationThread({
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
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
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
        <IconCell icon={channelIcon(conversation.channel)}>
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-sm font-medium">{detail.name}</h2>
            <span className="truncate text-xs text-muted-foreground">
              {detail.handle}
              {detail.account && conversation.channel !== "email"
                ? ` · ${channelLabel(conversation.channel)} ${channelHandle(conversation.channel, detail.account.handle)}`
                : ""}
            </span>
          </div>
        </IconCell>
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
      <Thread id={conversation._id} />
      {canWrite ? <Composer detail={detail} /> : null}
    </>
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
        last message. After that, send an approved template.
      </TooltipContent>
    </Tooltip>
  )
}

const STATUS_ICONS: Partial<Record<string, LucideIcon>> = {
  queued: ClockIcon,
  scheduled: ClockIcon,
  sent: CheckIcon,
  delivered: CheckCheckIcon,
  read: CheckCheckIcon,
  opened: CheckCheckIcon,
  clicked: CheckCheckIcon,
  failed: CircleAlertIcon,
  bounced: CircleAlertIcon,
}

function Thread({ id }: { id: Id<"conversations"> }) {
  const thread = useThread(id)
  if (thread.status === "LoadingFirstPage")
    return <Skeleton className="m-4 min-h-0 flex-1" />
  return (
    <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport preserveScrollOnPrepend>
          <MessageScrollerContent className="p-4">
            <LoadOlder
              canLoad={thread.status === "CanLoadMore"}
              onLoad={thread.loadOlder}
            />
            {thread.messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                <ThreadBubble message={message} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/** Loads older messages once the reader scrolls to the top. */
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

function ThreadBubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === "outbound"
  const StatusIcon = STATUS_ICONS[message.status]
  const href = messageHref(message.kind, message.id)
  return (
    <Message align={outbound ? "end" : "start"} data-testid="thread-message">
      <MessageContent>
        {message.subject ? (
          <MessageHeader>{message.subject}</MessageHeader>
        ) : null}
        {message.rendered || message.text ? (
          <Bubble
            align={outbound ? "end" : "start"}
            variant={
              message.error ? "destructive" : outbound ? "default" : "muted"
            }
          >
            <BubbleContent className="whitespace-pre-wrap">
              {message.rendered ? (
                <WhatsAppTemplatePreview rendered={message.rendered} embedded />
              ) : (
                message.text
              )}
            </BubbleContent>
          </Bubble>
        ) : null}
        {message.media.length ? (
          <MessageFiles messageId={message.id} media={message.media} />
        ) : null}
        <MessageFooter className="gap-1.5">
          <Link
            href={href}
            className="hover:underline"
            title={formatDateTime(message.at)}
          >
            <RelativeTime at={message.at} />
          </Link>
          {outbound ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                message.error && "text-destructive"
              )}
              data-testid="message-status"
            >
              {StatusIcon ? <StatusIcon className="size-3.5" /> : null}
              {message.kind === "email"
                ? emailStatusLabel(message.status as EmailStatus)
                : sentenceCase(message.status)}
            </span>
          ) : null}
        </MessageFooter>
        {message.error ? (
          <MessageFooter className="text-destructive">
            {message.error}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

/** Text when the channel allows it; on WhatsApp after the window closes,
    an approved template with its variables. */
function Composer({ detail }: { detail: ConversationDetail }) {
  const now = useClock()
  const { conversation } = detail
  const open = now === null || canReply(conversation, now)
  return (
    <div className="border-t border-border p-3">
      {open ? (
        <TextComposer detail={detail} />
      ) : (
        <TemplateComposer detail={detail} />
      )}
    </div>
  )
}

function useSend() {
  const { reply } = useConversationCommands()
  const [sending, setSending] = React.useState(false)
  return {
    sending,
    async send(args: Parameters<typeof reply>[0]) {
      setSending(true)
      try {
        await reply(args)
        return true
      } catch (error) {
        toast.add({ type: "error", title: actionError(error) })
        return false
      } finally {
        setSending(false)
      }
    },
  }
}

function TextComposer({ detail }: { detail: ConversationDetail }) {
  const { conversation } = detail
  const email = conversation.channel === "email"
  const [text, setText] = React.useState("")
  const { sending, send } = useSend()
  const [domainSearch, setDomainSearch] = React.useState("")
  const domains = useDomainOptions(
    { status: "verified", search: senderDomainSearch(domainSearch) },
    email
  )
  const senders = domains.map((domain) => defaultFromAddress(domain.name))
  const [from, setFrom] = React.useState<string>()
  const sender = from ?? replySender(detail.lastEmail?.to ?? [], senders)
  const senderItems = senders.map((value) => ({ value, label: value }))

  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!text.trim() || sending) return
    if (
      await send({
        id: conversation._id,
        text,
        ...(email ? { from: sender } : {}),
      })
    )
      setText("")
  }
  return (
    <form onSubmit={submit}>
      <InputGroup>
        <InputGroupTextarea
          aria-label="Reply"
          placeholder={
            email ? `Reply to ${detail.handle}…` : `Message ${detail.name}…`
          }
          value={text}
          rows={2}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
              void submit()
          }}
        />
        <InputGroupAddon align="block-end">
          {email ? (
            <OptionSelect
              size="sm"
              aria-label="From"
              value={sender}
              onChange={setFrom}
              items={senderItems}
              selectedItem={
                sender ? { value: sender, label: sender } : undefined
              }
              search={{
                onChange: setDomainSearch,
                placeholder: "Search domains…",
              }}
              placeholder="Choose a sender"
            />
          ) : null}
          <InputGroupButton
            type="submit"
            variant="default"
            size="sm"
            className="ml-auto"
            disabled={!text.trim() || sending || (email && !sender)}
          >
            <SendIcon data-icon="inline-start" />
            Send
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

function TemplateComposer({ detail }: { detail: ConversationDetail }) {
  const { conversation } = detail
  const [search, setSearch] = React.useState("")
  const [templateId, setTemplateId] = React.useState<string>()
  const [values, setValues] = React.useState<Record<string, string>>({})
  const templates = useApprovedTemplates(detail.account?.wabaId, search)
  const variables = useTemplateVariables(conversation._id, templateId)
  const { sending, send } = useSend()
  const items = templates.map((row) => ({
    value: row._id,
    label: `${row.name} · ${row.whatsapp?.language ?? ""}`,
  }))
  const missing = (variables ?? []).some((key) => !values[key]?.trim())

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!templateId || missing || sending) return
        const sent = await send({
          id: conversation._id,
          template: {
            id: templateId as Id<"templates">,
            variables: Object.fromEntries(
              (variables ?? []).map((key) => [key, values[key] ?? ""])
            ),
          },
        })
        if (sent) {
          setTemplateId(undefined)
          setValues({})
        }
      }}
    >
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>The 24-hour window is closed.</AlertTitle>
        <AlertDescription>Send an approved template.</AlertDescription>
      </Alert>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="reply-template">Template</FieldLabel>
          <OptionSelect
            id="reply-template"
            className="w-full"
            value={templateId}
            onChange={(value) => {
              setTemplateId(value)
              setValues({})
            }}
            items={items}
            search={{ onChange: setSearch, placeholder: "Search templates…" }}
            placeholder="Choose an approved template"
          />
        </Field>
        {(variables ?? []).map((key) => (
          <Field key={key}>
            <FieldLabel htmlFor={`reply-variable-${key}`}>
              {`Variable {{${key}}}`}
            </FieldLabel>
            <Input
              id={`reply-variable-${key}`}
              value={values[key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
      </FieldGroup>
      <Button
        type="submit"
        className="self-end"
        disabled={!templateId || variables === undefined || missing || sending}
      >
        <SendIcon data-icon="inline-start" />
        Send template
      </Button>
    </form>
  )
}
