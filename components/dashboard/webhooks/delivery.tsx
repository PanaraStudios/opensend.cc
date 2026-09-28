"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { api } from "@/convex/_generated/api"
import { actionError } from "@/lib/action-error"
import { deliveryResult } from "@/lib/dashboard/webhooks"
import {
  asWebhook,
  asWebhookDelivery,
  useWebhookCommands,
} from "@/lib/webhooks/use-webhooks"

export function WebhookDeliveryDetail() {
  const { id, deliveryId } = useParams<{ id: string; deliveryId: string }>()
  const router = useRouter()
  const { replayWebhookDelivery } = useWebhookCommands()
  const [replaying, setReplaying] = React.useState(false)
  const result = useQuery(api.webhooks.delivery, { id: deliveryId })
  const match = result?.webhook._id === id ? result : null
  const webhook = match && asWebhook(match.webhook)
  const delivery = match && asWebhookDelivery(match.delivery)

  if (result === undefined) return <Skeleton className="h-64 w-full" />
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
            disabled={!webhook.enabled || replaying}
            title={webhook.enabled ? undefined : "Enable the webhook to replay"}
            onClick={async () => {
              setReplaying(true)
              try {
                const next = await replayWebhookDelivery(delivery.id)
                toast.add({ type: "success", title: "Event replayed" })
                router.push(`/webhooks/${webhook.id}/${next}`)
              } catch (e) {
                toast.add({ type: "error", title: actionError(e) })
              } finally {
                setReplaying(false)
              }
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
            value: deliveryResult(delivery),
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
