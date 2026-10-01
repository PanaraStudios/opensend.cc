"use client"

import * as React from "react"
import Link from "next/link"
import { KeyRoundIcon, RefreshCwIcon, UnplugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  ChannelAccountStatusBadge,
  ChannelQualityBadge,
  DocsButton,
  EmptyState,
  IconCell,
  ListPagination,
  MoreMenu,
  PageHeader,
  RelativeTime,
  ResourceTable,
  Th,
  ToolbarFilters,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  CopyChannelHandleItem,
  CHANNEL_ICONS,
  CHANNEL_ITEMS,
  ChannelsIcon,
  DisconnectBusinessDialog,
  MetaAppAlert,
  RegisterNumberDialog,
} from "@/components/dashboard/channels/shared"
import {
  ConnectMetaButton,
  ManualConnectDialog,
} from "@/components/dashboard/channels/connect-meta"
import { api } from "@/convex/_generated/api"
import { channelHandle } from "@/lib/meta/account-display"
import type { MessagingChannel } from "@/lib/dashboard/types"
import {
  useChannelCommands,
  useMetaPublicConfig,
  type ChannelAccount,
  type ConnectedBusiness,
} from "@/lib/channels/use-channels"

export function ChannelsView() {
  const { canWrite, syncAccount, syncing } = useChannelCommands()
  const config = useMetaPublicConfig()
  const [channel, setChannel] = React.useState("all")
  const [manualOpen, setManualOpen] = React.useState<
    "whatsapp" | "page" | null
  >(null)
  const [registering, setRegistering] = React.useState<{
    id: string
    handle: string
  } | null>(null)
  const [disconnecting, setDisconnecting] =
    React.useState<ChannelAccount | null>(null)

  const accounts = useTeamList(
    api.meta.connect.listAccounts,
    api.meta.connect.countAccounts,
    channel !== "all" ? { channel: channel as MessagingChannel } : {}
  )
  const { rows, pageRows, pagination } = accounts
  const unfiltered = channel === "all"

  /** After connecting, ask for the first new number's PIN right away. */
  function connected(result: ConnectedBusiness) {
    const pending = result.accounts.find((account) => !account.registered)
    if (pending) setRegistering({ id: pending.id, handle: pending.handle })
  }

  const connectButtons = (
    <>
      <Button
        variant="outline"
        disabled={!canWrite || !config?.configured}
        onClick={() => setManualOpen("whatsapp")}
      >
        <KeyRoundIcon />
        Connect manually
      </Button>
      <ConnectMetaButton
        config={config}
        onConnected={connected}
        onManualPage={() => setManualOpen("page")}
      />
    </>
  )

  return (
    <>
      <PageHeader
        title="Channels"
        description="Connect WhatsApp numbers, Facebook Pages and Instagram professional accounts to send and receive messages."
      >
        {connectButtons}
        <DocsButton />
      </PageHeader>
      {config ? (
        <>
          <MetaAppAlert config={config} />
          {config.configured ? (
            <MetaAppAlert config={config} channel="page" />
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarFilters
          filters={[
            {
              value: channel,
              onChange: setChannel,
              items: CHANNEL_ITEMS,
              "aria-label": "Filter by channel",
            },
          ]}
        />
      </div>
      {accounts.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ChannelsIcon}
          title={unfiltered ? "No channels" : "No channels found"}
          description={
            unfiltered
              ? "Connect a WhatsApp Business Account or Facebook Page and its linked Instagram account."
              : "No channels match this filter."
          }
        >
          {unfiltered ? connectButtons : null}
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Channel</Th>
                <Th>Business</Th>
                <Th>Status</Th>
                <Th>Quality</Th>
                <Th>Created</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((account) => (
              <TableRow key={account._id}>
                <TableCell>
                  <IconCell icon={CHANNEL_ICONS[account.channel]}>
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/channels/${account._id}`}
                        className="font-medium hover:underline"
                      >
                        {account.displayName}
                      </Link>
                      <span className="text-caption text-muted-foreground">
                        {channelHandle(account.channel, account.handle)}
                      </span>
                    </div>
                  </IconCell>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {account.businessName}
                </TableCell>
                <TableCell>
                  <ChannelAccountStatusBadge status={account.status} />
                </TableCell>
                <TableCell>
                  {account.channel === "whatsapp" ? (
                    <ChannelQualityBadge
                      quality={account.quality ?? "unknown"}
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime at={account._creationTime} />
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <CopyChannelHandleItem account={account} />
                      <DropdownMenuItem
                        disabled={!canWrite || syncing === account._id}
                        onClick={() => void syncAccount(account)}
                      >
                        <RefreshCwIcon />
                        Sync
                      </DropdownMenuItem>
                      {account.channel === "whatsapp" &&
                      account.registeredAt === undefined ? (
                        <DropdownMenuItem
                          disabled={!canWrite}
                          onClick={() =>
                            setRegistering({
                              id: account._id,
                              handle: account.handle,
                            })
                          }
                        >
                          <KeyRoundIcon />
                          Register number
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={!canWrite}
                        variant="destructive"
                        onClick={() => setDisconnecting(account)}
                      >
                        <UnplugIcon />
                        Disconnect business
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="channel" />
        </>
      )}
      <ManualConnectDialog
        open={manualOpen !== null}
        mode={manualOpen ?? "whatsapp"}
        onOpenChange={(open) => {
          if (!open) setManualOpen(null)
        }}
        onConnected={connected}
      />
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
    </>
  )
}
