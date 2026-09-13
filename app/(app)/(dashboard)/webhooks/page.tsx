import type { Metadata } from "next"

import { WebhooksView } from "@/components/dashboard/webhooks"

export const metadata: Metadata = {
  title: "Webhooks",
}

export default function WebhooksPage() {
  return <WebhooksView />
}
