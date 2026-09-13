import type { Metadata } from "next"

import { ReceivedDetail } from "@/components/dashboard/emails"

export const metadata: Metadata = {
  title: "Received email",
}

export default function ReceivedDetailPage() {
  return <ReceivedDetail />
}
