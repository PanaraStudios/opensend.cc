"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import {
  CodeWell,
  DetailHeader,
  DetailSection,
  HttpStatusBadge,
  JsonSection,
  MetaStrip,
  MonoValue,
  NotFoundState,
  RelativeTime,
} from "@/components/dashboard/primitives"
import { WebhookIcon } from "@/components/dashboard/webhooks/shared"
import { useDashboard } from "@/lib/dashboard/store"
import { isDeliveryFailed } from "@/lib/dashboard/webhooks"

export function WebhookDeliveryDetail() {
  const { id, deliveryId } = useParams<{ id: string; deliveryId: string }>()
  const router = useRouter()
  const { state, replayWebhookDelivery } = useDashboard()
  const webhook = state.webhooks.find((item) => item.id === id)
  const delivery = state.webhookDeliveries.find(
    (item) => item.id === deliveryId && item.webhookId === id
  )

  if (!webhook || !delivery) {
    return (
      <NotFoundState
        icon={WebhookIcon}
        noun="delivery"
        backHref={webhook ? `/webhooks/${id}` : "/webhooks"}
        backLabel={webhook ? "Back to webhook" : "Back to webhooks"}
        description="It may have been removed with its webhook."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref={`/webhooks/${webhook.id}`}
        backLabel="Webhook"
        title={delivery.event}
        icon={WebhookIcon}
        badge={<HttpStatusBadge status={delivery.status} />}
        actions={
          <Button
            variant="outline"
            /* A disabled webhook is sent nothing, a replay included. */
            disabled={!webhook.enabled}
            title={webhook.enabled ? undefined : "Enable the webhook to replay"}
            onClick={() => {
              const next = replayWebhookDelivery(delivery.id)
              if (!next) return
              toast.add({ type: "success", title: "Event replayed" })
              router.push(`/webhooks/${webhook.id}/${next.id}`)
            }}
          >
            <RotateCwIcon data-icon="inline-start" />
            Replay
          </Button>
        }
      />
      <MetaStrip
        items={[
          {
            label: "Endpoint",
            value: (
              <Link
                href={`/webhooks/${webhook.id}`}
                className="truncate font-mono"
              >
                {webhook.endpoint}
              </Link>
            ),
          },
          {
            label: "Result",
            value: isDeliveryFailed(delivery) ? "Failed" : "Succeeded",
          },
          { label: "Sent", value: <RelativeTime at={delivery.createdAt} /> },
          { label: "Attempts", value: delivery.attempts },
          { label: "Duration", value: `${delivery.durationMs} ms` },
          {
            label: "Id",
            value: <MonoValue copyValue={delivery.id}>{delivery.id}</MonoValue>,
          },
        ]}
      />
      <JsonSection title="Request body" value={delivery.payload} />
      <DetailSection title="Response body">
        <CodeWell copyValue={delivery.response}>{delivery.response}</CodeWell>
      </DetailSection>
    </div>
  )
}
