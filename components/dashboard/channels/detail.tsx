"use client"

import { CallingPanel } from "./calling"
import * as React from "react"
import { useParams } from "next/navigation"
import {
  BadgeCheckIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  PlugIcon,
  ShieldCheckIcon,
  UnplugIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ChannelAccountStatusBadge,
  ChannelQualityBadge,
  DetailField,
  DetailSection,
  EventTrail,
  MetaStrip,
  MonoValue,
  NotFoundState,
  RelativeTime,
  Surface,
  useDeleteRecord,
  type EventTrailStep,
} from "@/components/dashboard/primitives"
import {
  CopyChannelHandleItem,
  CHANNEL_ICONS,
  ChannelDetailHeader,
  ChannelsIcon,
  DisconnectBusinessDialog,
  RegisterNumberDialog,
} from "@/components/dashboard/channels/shared"
import { channelHandle } from "@/lib/meta/account-display"
import { CHANNELS } from "@/lib/channels"
import { formatDateTime, messagingLimitLabel } from "@/lib/dashboard/format"
import {
  useChannelAccount,
  useChannelCommands,
} from "@/lib/channels/use-channels"

const METHOD_LABELS = {
  embedded_signup: "Embedded Signup",
  manual_token: "System user token",
  facebook_login: "Facebook Login",
} as const

export function ChannelDetail() {
  const { id } = useParams<{ id: string }>()
  const result = useChannelAccount(id)
  const { canWrite, syncAccount, syncing } = useChannelCommands()
  const { leaving, deleteAndLeave } = useDeleteRecord("/channels")
  const [registering, setRegistering] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)

  if (result === undefined) return <Skeleton className="h-64 w-full" />
  if (!result) {
    if (leaving) return null
    return (
      <NotFoundState icon={ChannelsIcon} noun="channel" backHref="/channels" />
    )
  }
  const { account, connection } = result
  const whatsapp = account.channel === "whatsapp"
  const registered = account.registeredAt !== undefined

  const steps: EventTrailStep[] = [
    {
      id: "connected",
      icon: PlugIcon,
      label: "Connected",
      caption: formatDateTime(account._creationTime),
    },
    ...(whatsapp
      ? [
          {
            id: "registered",
            icon: BadgeCheckIcon,
            label: "Registered",
            caption: registered
              ? formatDateTime(account.registeredAt!)
              : undefined,
          },
        ]
      : []),
    {
      id: "checked",
      icon: ShieldCheckIcon,
      label: "Last checked",
      caption:
        connection.checkedAt === undefined
          ? undefined
          : formatDateTime(connection.checkedAt),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <ChannelDetailHeader
        title={account.displayName}
        description={channelHandle(account.channel, account.handle)}
        icon={CHANNEL_ICONS[account.channel]}
        actions={
          !whatsapp || registered ? null : (
            <Button
              variant="outline"
              disabled={!canWrite}
              onClick={() => setRegistering(true)}
            >
              <KeyRoundIcon data-icon="inline-start" />
              Register number
            </Button>
          )
        }
        refresh={{
          label: "Sync",
          pendingLabel: "Syncing…",
          pending: !!syncing,
          disabled: !canWrite,
          onClick: () => void syncAccount(account),
        }}
        menu={<CopyChannelHandleItem account={account} />}
        remove={{
          label: "Disconnect business",
          icon: UnplugIcon,
          disabled: !canWrite,
          onClick: () => setDisconnecting(true),
        }}
      />
      <MetaStrip
        items={[
          { label: "Channel", value: CHANNELS[account.channel].label },
          {
            label: "Status",
            value: <ChannelAccountStatusBadge status={account.status} />,
          },
          ...(whatsapp
            ? [
                {
                  label: "Quality",
                  value: (
                    <ChannelQualityBadge
                      quality={account.quality ?? "unknown"}
                    />
                  ),
                },
                {
                  label: "Throughput",
                  value: `${account.throughputMps} messages/s`,
                },
                {
                  label: "Messaging limit",
                  value: messagingLimitLabel(account.messagingLimit),
                },
                {
                  label: "Registered",
                  value: (
                    <RelativeTime
                      at={account.registeredAt ?? null}
                      fallback="Not registered"
                    />
                  ),
                },
              ]
            : []),
          { label: "Business", value: account.businessName },
        ]}
      />
      {connection.status === "error" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Reconnect this business</AlertTitle>
          <AlertDescription>
            {connection.error ?? "Meta refused the business token."}
          </AlertDescription>
        </Alert>
      ) : account.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>This account needs attention</AlertTitle>
          <AlertDescription>{account.error}</AlertDescription>
        </Alert>
      ) : null}
      <DetailSection title="Channel events">
        <EventTrail steps={steps} />
      </DetailSection>
      <Surface>
        <h2 className="text-base font-medium">Connection</h2>
        <dl className="grid gap-5 sm:grid-cols-2">
          <DetailField label={CHANNELS[account.channel].idLabel}>
            <MonoValue copyValue={account.externalId}>
              {account.externalId}
            </MonoValue>
          </DetailField>
          {whatsapp ? (
            <DetailField label="WhatsApp Business Account">
              {account.wabaId ? (
                <MonoValue copyValue={account.wabaId}>
                  {result.wabaName
                    ? `${result.wabaName} (${account.wabaId})`
                    : account.wabaId}
                </MonoValue>
              ) : (
                "—"
              )}
            </DetailField>
          ) : account.channel === "instagram" ? (
            <>
              <DetailField label="Instagram username">
                {channelHandle(account.channel, account.handle)}
              </DetailField>
              <DetailField label="Linked Page">
                {account.pageId ? (
                  <MonoValue copyValue={account.pageId}>
                    {account.pageId}
                  </MonoValue>
                ) : (
                  "—"
                )}
              </DetailField>
            </>
          ) : null}
          <DetailField label="Business ID">
            <MonoValue copyValue={connection.businessId}>
              {connection.businessId}
            </MonoValue>
          </DetailField>
          <DetailField label="Connected with">
            {METHOD_LABELS[connection.method]}
          </DetailField>
          <DetailField label="Access token">
            Ending in {connection.tokenLast4}
          </DetailField>
          <DetailField label="Last checked">
            <RelativeTime at={connection.checkedAt ?? null} fallback="Never" />
          </DetailField>
        </dl>
      </Surface>
      {whatsapp ? (
        <CallingPanel
          key={account._id}
          accountId={account._id}
          canWrite={canWrite}
        />
      ) : null}
      <RegisterNumberDialog
        account={
          registering ? { id: account._id, handle: account.handle } : null
        }
        onOpenChange={setRegistering}
      />
      <DisconnectBusinessDialog
        account={
          disconnecting
            ? {
                connectionId: account.connectionId,
                businessName: account.businessName,
              }
            : null
        }
        onOpenChange={setDisconnecting}
        onDisconnected={() => deleteAndLeave(() => {})}
      />
    </div>
  )
}
