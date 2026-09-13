import type { Metadata } from "next"

import { ReceivingView } from "@/components/dashboard/emails"

export const metadata: Metadata = {
  title: "Receiving",
}

export default function ReceivingPage() {
  return <ReceivingView />
}
