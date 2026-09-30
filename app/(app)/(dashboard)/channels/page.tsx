import type { Metadata } from "next"

import { ChannelsView } from "@/components/dashboard/channels/list"

export const metadata: Metadata = {
  title: "Channels",
}

export default function ChannelsPage() {
  return <ChannelsView />
}
