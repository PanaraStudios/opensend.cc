import type { Metadata } from "next"

import { BroadcastsView } from "@/components/dashboard/broadcasts/list"

export const metadata: Metadata = {
  title: "Broadcasts",
}

export default function BroadcastsPage() {
  return <BroadcastsView />
}
