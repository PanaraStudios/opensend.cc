import type { Metadata } from "next"
import { Suspense } from "react"

import { InboxView } from "@/components/dashboard/emails/inbox"

export const metadata: Metadata = {
  title: "Inbox",
}

export default function InboxPage() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  )
}
