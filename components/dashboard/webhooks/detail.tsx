"use client"

import * as React from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  DetailHeader,
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
  usePagination,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  WebhookIcon,
  WebhookMenu,
  WebhooksDocsSheet,
  WebhookStatusBadge,
} from "@/components/dashboard/webhooks/shared"
import { useDashboard } from "@/lib/dashboard/store"
import {
  isDeliveryFailed,
  sortWebhookEvents,
  webhookDeliveries,
  webhookEventsLabel,
} from "@/lib/dashboard/webhooks"

const DELIVERY_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
]

export function WebhookDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, deleteWebhook } = useDashboard()
  const { leaving, deleteAndLeave } = useDeleteRecord("/webhooks")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [status, setStatus] = React.useState("all")
  const [eventType, setEventType] = React.useState("all")
  const webhook = state.webhooks.find((item) => item.id === id)

  const deliveries = React.useMemo(
    () => webhookDeliveries(state.webhookDeliveries, id),
    [state.webhookDeliveries, id]
  )
  const rows = deliveries.filter(
    (item) =>
      (status === "all" || isDeliveryFailed(item) === (status === "failed")) &&
      (eventType === "all" || item.event === eventType)
  )
  const { pageRows, pagination } = usePagination(rows)

  if (!webhook) {
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
            <DocsButton onClick={() => setDocsOpen(true)} />
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
            value: `${deliveries.length} sent, ${deliveries.filter(isDeliveryFailed).length} failed`,
          },
          {
            label: "Last delivery",
            value: (
              <RelativeTime
                at={deliveries[0]?.createdAt ?? null}
                fallback="Never"
              />
            ),
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
              <Badge variant="outline" className="font-mono">
                {event}
              </Badge>
            </li>
          ))}
        </ul>
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
                  ...sortWebhookEvents(
                    deliveries.map((delivery) => delivery.event)
                  ).map((event) => ({ value: event, label: event })),
                ],
                "aria-label": "Filter by event",
              },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={WebhookIcon}
            title={
              deliveries.length === 0
                ? "No deliveries yet"
                : "No deliveries found"
            }
            description={
              deliveries.length === 0
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
                      {delivery.event}
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
              noun="delivery"
              plural="deliveries"
            />
          </>
        )}
      </DetailSection>
      <WebhooksDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}
