"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import type { FunctionReturnType } from "convex/server"
import {
  CopyIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { useExportDialog } from "@/components/dashboard/export-dialog"
import {
  ChannelAccountStatusBadge,
  DocsButton,
  EmptyState,
  IconCell,
  ListPagination,
  ListToolbar,
  PageHeader,
  RelativeTime,
  ResourceTable,
  StatusBadge,
  Th,
  copyToClipboard,
  useListSearch,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  CHANNEL_FILTER_ITEMS,
  ChannelMenu,
  ChannelsIcon,
  CopyChannelHandleItem,
  DisconnectBusinessDialog,
  RegisterNumberDialog,
  channelIcon,
} from "@/components/dashboard/channels/shared"
import { useAddChannel } from "@/components/dashboard/channels/add-channel"
import { DeleteDomainDialog } from "@/components/dashboard/domains/shared"
import { api } from "@/convex/_generated/api"
import { actionError } from "@/lib/action-error"
import { CHANNELS, CHANNEL_IDS, type Channel } from "@/lib/channels"
import {
  useChannelCommands,
  type ChannelAccount,
  type ConnectedBusiness,
} from "@/lib/channels/use-channels"
import { regionLabel } from "@/lib/dashboard/format"
import type { Domain } from "@/lib/dashboard/types"
import { channelHandle } from "@/lib/meta/account-display"
import { asDomain, useDomainCheck } from "@/lib/domains/use-domains"

type ChannelRow =
  | { kind: "domain"; id: string; lastActivity: number; domain: Domain }
  | {
      kind: "account"
      id: string
      lastActivity: number
      account: ChannelAccount
    }

/** A row as the table shows it; last activity is the newest check. */
function asChannelRow(
  item: FunctionReturnType<typeof api.channels.senders.list>["page"][number]
): ChannelRow {
  if (item.kind === "domain") {
    const { domain } = item
    return {
      kind: "domain",
      id: domain._id,
      lastActivity: Math.max(
        domain._creationTime,
        domain.checkedAt ?? 0,
        domain.verifiedAt ?? 0
      ),
      domain: asDomain(domain),
    }
  }
  const { account } = item
  return {
    kind: "account",
    id: account._id,
    lastActivity: Math.max(
      account._creationTime,
      account.checkedAt ?? 0,
      account.registeredAt ?? 0
    ),
    account,
  }
}

/** What every row has, whatever its channel. */
function rowSummary(row: ChannelRow) {
  if (row.kind === "domain")
    return {
      channel: "email" as Channel,
      href: `/domains/${row.id}`,
      name: row.domain.name,
      caption: regionLabel(row.domain.region),
      status: row.domain.claiming ? (
        <Badge variant="secondary">Claim in progress</Badge>
      ) : (
        <StatusBadge status={row.domain.status} />
      ),
    }
  const { account } = row
  return {
    channel: account.channel as Channel,
    href: `/channels/${row.id}`,
    name: account.displayName,
    caption: channelHandle(account.channel, account.handle),
    status: <ChannelAccountStatusBadge status={account.status} />,
  }
}

/** The channel filter lives in `?type=`, so old Domains links and
    shortcuts land on email. */
function useChannelFilter() {
  const router = useRouter()
  const type = useSearchParams().get("type")
  const channel = CHANNEL_IDS.find((id) => id === type) ?? "all"
  const setChannel = (next: string) =>
    router.replace(next === "all" ? "/channels" : `/channels?type=${next}`)
  return [channel, setChannel] as const
}

export function ChannelsView() {
  const { canWrite, syncAccount, syncing } = useChannelCommands()
  const { query, setQuery, search } = useListSearch()
  const [channel, setChannel] = useChannelFilter()
  const [registering, setRegistering] = React.useState<{
    id: string
    handle: string
  } | null>(null)
  const [disconnecting, setDisconnecting] =
    React.useState<ChannelAccount | null>(null)
  const [deleting, setDeleting] = React.useState<Domain | null>(null)

  /** After connecting, ask for the first new number's PIN right away. */
  function connected(result: ConnectedBusiness) {
    const pending = result.accounts.find((account) => !account.registered)
    if (pending) setRegistering({ id: pending.id, handle: pending.handle })
  }
  const adding = useAddChannel({ onConnected: connected })

  const channels = useTeamList(
    api.channels.senders.list,
    api.channels.senders.count,
    { search, ...(channel !== "all" ? { channel } : {}) },
    asChannelRow
  )
  const { rows, pageRows, pagination } = channels
  const domains = React.useMemo(
    () => rows.flatMap((row) => (row.kind === "domain" ? [row.domain] : [])),
    [rows]
  )
  const check = useDomainCheck(domains)
  const unfiltered = !query && channel === "all"
  // Domains keep their export; the other channels have none.
  const exporting = useExportDialog({
    resource: "domains",
    noun: "domains",
    filters: { search: query.trim() || undefined },
  })

  async function verify(id: string) {
    try {
      await check(id)
    } catch (e) {
      toast.add({ type: "error", title: actionError(e) })
    }
  }

  return (
    <>
      <PageHeader
        title="Channels"
        description="Email domains, WhatsApp numbers, Facebook Pages and Instagram accounts this team sends and receives with."
      >
        {adding.menu}
        <DocsButton />
      </PageHeader>
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search channels…"
        onExport={channel === "email" ? exporting.open : undefined}
        filters={[
          {
            value: channel,
            onChange: setChannel,
            items: CHANNEL_FILTER_ITEMS,
            "aria-label": "Filter by channel",
          },
        ]}
      />
      {channels.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ChannelsIcon}
          title={unfiltered ? "No channels" : "No channels found"}
          description={
            unfiltered
              ? "Add an email domain, or connect WhatsApp, Messenger or Instagram, to send and receive messages."
              : "No channels match these filters."
          }
        >
          {unfiltered ? adding.menu : null}
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th>Last activity</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((row) => {
              const summary = rowSummary(row)
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <IconCell icon={channelIcon(summary.channel)}>
                      <div className="flex min-w-0 flex-col">
                        <Link
                          href={summary.href}
                          className="truncate font-medium hover:underline"
                        >
                          {summary.name}
                        </Link>
                        <span className="truncate text-caption text-muted-foreground">
                          {summary.caption}
                        </span>
                      </div>
                    </IconCell>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {CHANNELS[summary.channel].label}
                  </TableCell>
                  <TableCell>{summary.status}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime at={row.lastActivity} />
                  </TableCell>
                  <TableCell>
                    {row.kind === "domain" ? (
                      <ChannelMenu
                        remove={{
                          label: "Delete domain",
                          icon: Trash2Icon,
                          disabled: !canWrite,
                          onClick: () => setDeleting(row.domain),
                        }}
                      >
                        <DropdownMenuItem
                          onClick={() =>
                            void copyToClipboard(row.domain.name, "Domain")
                          }
                        >
                          <CopyIcon />
                          Copy domain
                        </DropdownMenuItem>
                        {row.domain.status === "verified" ||
                        row.domain.claiming ? null : (
                          <DropdownMenuItem
                            disabled={!canWrite || row.domain.checking}
                            onClick={() => void verify(row.id)}
                          >
                            <RefreshCwIcon />
                            Check DNS records
                          </DropdownMenuItem>
                        )}
                      </ChannelMenu>
                    ) : (
                      <ChannelMenu
                        remove={{
                          label: "Disconnect business",
                          icon: UnplugIcon,
                          disabled: !canWrite,
                          onClick: () => setDisconnecting(row.account),
                        }}
                      >
                        <CopyChannelHandleItem account={row.account} />
                        <DropdownMenuItem
                          disabled={!canWrite || syncing === row.id}
                          onClick={() => void syncAccount(row.account)}
                        >
                          <RefreshCwIcon />
                          Sync
                        </DropdownMenuItem>
                        {row.account.channel === "whatsapp" &&
                        row.account.registeredAt === undefined ? (
                          <DropdownMenuItem
                            disabled={!canWrite}
                            onClick={() =>
                              setRegistering({
                                id: row.id,
                                handle: row.account.handle,
                              })
                            }
                          >
                            <KeyRoundIcon />
                            Register number
                          </DropdownMenuItem>
                        ) : null}
                      </ChannelMenu>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </ResourceTable>
          <ListPagination {...pagination} noun="channel" />
        </>
      )}
      {adding.dialogs}
      <RegisterNumberDialog
        account={registering}
        onOpenChange={(open) => {
          if (!open) setRegistering(null)
        }}
      />
      <DisconnectBusinessDialog
        account={
          disconnecting && {
            connectionId: disconnecting.connectionId,
            businessName: disconnecting.businessName,
          }
        }
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null)
        }}
      />
      <DeleteDomainDialog
        domain={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      />
    </>
  )
}
