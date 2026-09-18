import type { Metadata } from "next"

import { WebhookDetail } from "@/components/dashboard/webhooks/detail"

export const metadata: Metadata = {
  title: "Webhook",
}

export default function WebhookDetailPage() {
  return <WebhookDetail />
}
