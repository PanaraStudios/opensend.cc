import type { Metadata } from "next"

import { WebhookDeliveryDetail } from "@/components/dashboard/webhooks/delivery"

export const metadata: Metadata = {
  title: "Webhook delivery",
}

export default function WebhookDeliveryPage() {
  return <WebhookDeliveryDetail />
}
