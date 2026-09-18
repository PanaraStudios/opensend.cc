import type { Metadata } from "next"

import { ReceivingView } from "@/components/dashboard/emails/lists"

export const metadata: Metadata = {
  title: "Receiving",
}

export default function ReceivingPage() {
  return <ReceivingView />
}
