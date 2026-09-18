import type { Metadata } from "next"

import { BroadcastDetail } from "@/components/dashboard/broadcasts/detail"

export const metadata: Metadata = {
  title: "Broadcast",
}

export default function BroadcastDetailPage() {
  return <BroadcastDetail />
}
