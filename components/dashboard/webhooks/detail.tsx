"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { useQuery } from "convex/react"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  DetailHeader,
  JsonSection,
  OptionSelect,
  DetailSection,
  DocsButton,
  EmptyState,
  HttpStatusBadge,
  ListPagination,
  MetaStrip,
  MonoLink,
  NotFoundState,
  RelativeTime,
  ResourceTable,
  SecretField,
  Th,
  ToolbarFilters,
  useDeleteRecord,
  usePagedList,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  WebhookIcon,
  WebhookMenu,
  WebhookStatusBadge,
} from "@/components/dashboard/webhooks/shared"
import { api } from "@/convex/_generated/api"
import type { WebhookEvent } from "@/lib/dashboard/types"
import {
  WEBHOOK_EVENT_GROUPS,
  webhookEventSample,
  webhookEventLabel,
  sortWebhookEvents,
  webhookEventsLabel,
} from "@/lib/dashboard/webhooks"
import {
  asWebhook,
  asWebhookDelivery,
  useWebhookCommands,
} from "@/lib/webhooks/use-webhooks"

const DELIVERY_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
]

export function WebhookDetail() {
  const { id } = useParams<{ id: string }>()
  const { deleteWebhook } = useWebhookCommands()
  const { leaving, deleteAndLeave } = useDeleteRecord("/webhooks")
  const [sampleEvent, setSampleEvent] =
    React.useState<WebhookEvent>("email.sent")
  const [status, setStatus] = React.useState("all")
  const [eventType, setEventType] = React.useState("all")
  const result = useQuery(api.webhooks.get, { id })
  const signingSecret = useQuery(api.webhooks.signingSecret, { id })
  const webhook = React.useMemo(
    () => result && asWebhook(result.webhook, signingSecret ?? ""),
    [result, signingSecret]
  )
  const {
    rows,
    status: loading,
    pageRows,
    pagination,
  } = usePagedList(
    api.webhooks.deliveries,
    api.webhooks.deliveryCount,
    result
      ? {
          webhookId: result.webhook._id,
          ...(status !== "all" ? { failed: status === "failed" } : {}),
          ...(eventType !== "all" ? { event: eventType } : {}),
        }
      : "skip",
    asWebhookDelivery
  )

  if (result === undefined || signingSecret === undefined)
    return <Skeleton className="h-64 w-full" />
  if (!result || !webhook) {
    if (leaving) return null
    return (
      <NotFoundState icon={WebhookIcon} noun="webhook" backHref="/webhooks" />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/webhooks"
        backLabel="Webhooks"
        title={webhook.endpoint}
        icon={WebhookIcon}
        badge={<WebhookStatusBadge enabled={webhook.enabled} />}
        actions={
          <>
            <DocsButton />
            <WebhookMenu
              webhook={webhook}
              inDetail
              onDelete={() => deleteAndLeave(() => deleteWebhook(webhook.id))}
            />
          </>
        }
      />
      <MetaStrip
        items={[
          {
            label: "Listening for",
            value: webhookEventsLabel(webhook.events),
          },
          {
            label: "Deliveries",
            value: `${result.deliveries} sent, ${result.failed} failed`,
          },
          {
            label: "Last delivery",
            value: <RelativeTime at={result.lastDeliveryAt} fallback="Never" />,
          },
          { label: "Created", value: <RelativeTime at={webhook.createdAt} /> },
        ]}
      />
      <DetailSection title="Signing secret" className="max-w-xl">
        {/* Keyed so a rotated secret comes back hidden. */}
        <SecretField
          key={webhook.signingSecret}
          label="Signing secret"
          value={webhook.signingSecret}
        />
      </DetailSection>
      <DetailSection title="Events">
        <ul className="flex flex-wrap gap-1.5">
          {webhook.events.map((event) => (
            <li key={event}>
              <Badge variant="outline" title={event}>
                {webhookEventLabel(event)}
              </Badge>
            </li>
          ))}
        </ul>
      </DetailSection>
      <DetailSection title="Sample payload">
        <p className="text-sm text-muted-foreground">
          An example from the event catalog. Actual values come from your
          messages and contacts.
        </p>
        <OptionSelect
          aria-label="Sample event"
          value={sampleEvent}
          onChange={(value) => setSampleEvent(value as WebhookEvent)}
          items={WEBHOOK_EVENT_GROUPS.flatMap((group) =>
            group.events.map((event) => ({
              value: event,
              label: webhookEventLabel(event),
              group: group.label,
            }))
          )}
        />
        <JsonSection title="Payload" value={webhookEventSample(sampleEvent)} />
      </DetailSection>
      <DetailSection
        title="Deliveries"
        actions={
          <ToolbarFilters
            filters={[
              {
                value: status,
                onChange: setStatus,
                items: DELIVERY_STATUS_ITEMS,
                "aria-label": "Filter by status",
              },
              {
                value: eventType,
                onChange: setEventType,
                items: [
                  { value: "all", label: "All events" },
                  /* What was delivered, not what is subscribed to now: past
                     deliveries outlive a change of subscriptions. */
                  ...sortWebhookEvents(result.delivered as WebhookEvent[]).map(
                    (event) => ({
                      value: event,
                      label: webhookEventLabel(event),
                    })
                  ),
                ],
                "aria-label": "Filter by event",
              },
            ]}
          />
        }
      >
        {loading === "LoadingFirstPage" ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={WebhookIcon}
            title={
              result.deliveries === 0
                ? "No deliveries yet"
                : "No deliveries found"
            }
            description={
              result.deliveries === 0
                ? "Events sent to this endpoint show up here."
                : "Nothing matches this status and event."
            }
          />
        ) : (
          <>
            <ResourceTable
              headers={
                <>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th className="text-right">Sent</Th>
                </>
              }
            >
              {pageRows.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <MonoLink href={`/webhooks/${webhook.id}/${delivery.id}`}>
                      {webhookEventLabel(delivery.event)}
                    </MonoLink>
                  </TableCell>
                  <TableCell>
                    <HttpStatusBadge status={delivery.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {delivery.attempts}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <RelativeTime at={delivery.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </ResourceTable>
            <ListPagination
              {...pagination}
              embedded
              noun="delivery"
              plural="deliveries"
            />
          </>
        )}
      </DetailSection>
    </div>
  )
}
