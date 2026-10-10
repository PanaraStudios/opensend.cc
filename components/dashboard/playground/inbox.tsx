"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { InboxIcon, MessagesSquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ItemGroup } from "@/components/ui/item"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DocsButton,
  SectionChrome,
  EmptyState,
  ListPagination,
  ListToolbar,
  useListSearch,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { MESSAGE_CHANNEL_ITEMS } from "@/components/dashboard/channels/shared"
import {
  ConversationRow,
  logChannel,
} from "@/components/dashboard/emails/shared"
import { useIsMobile } from "@/hooks/use-mobile"
import { useConversationList } from "@/lib/messages/use-messages"
import { threadHref } from "@/lib/messages/links"
import { ConversationThread } from "../conversation/conversation-thread"

import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { inboxEmptyDescription } from "@/lib/dashboard/inbox-empty"
import { SendMessageAction } from "../conversation/send-message-action"

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
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={
        <>
          <SendMessageAction />
          <DocsButton />
        </>
      }
    >
      <div
        className="frame h-[calc(100svh-14rem)] min-h-0"
        data-testid="inbox-layout"
      >
        <div className="panel h-full min-h-0 overflow-hidden p-0">
          {mobile ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* Keep the list mounted so filters and the page survive opening a thread. */}
              <div className={selected ? "hidden" : "h-full min-h-0"}>
                {list}
              </div>
              {selected ? <div className="h-full min-h-0">{thread}</div> : null}
            </div>
          ) : (
            <ResizablePanelGroup
              orientation="horizontal"
              className="h-full min-h-0"
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
    </SectionChrome>
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
  const connected = useTeamQuery(api.conversations.connectedChannels)
  const filtered = !!search.trim() || channel !== "all" || state !== "all"

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
            description={inboxEmptyDescription(!!connected?.length, filtered)}
          >
            {!connected?.length && !filtered ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/channels" />}
              >
                Connect a channel
              </Button>
            ) : null}
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
