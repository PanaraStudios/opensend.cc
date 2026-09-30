import type { Metadata } from "next"

import { ChannelDetail } from "@/components/dashboard/channels/detail"

export const metadata: Metadata = {
  title: "Channel",
}

export default function ChannelDetailPage() {
  return <ChannelDetail />
}
