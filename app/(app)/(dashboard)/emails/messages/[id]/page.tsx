import type { Metadata } from "next"

import { ChannelMessageDetail } from "@/components/dashboard/emails/detail"

export const metadata: Metadata = {
  title: "Message",
}

export default function ChannelMessagePage() {
  return <ChannelMessageDetail />
}
