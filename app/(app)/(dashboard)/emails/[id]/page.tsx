import type { Metadata } from "next"

import { EmailDetail } from "@/components/dashboard/emails"

export const metadata: Metadata = {
  title: "Email",
}

export default function EmailDetailPage() {
  return <EmailDetail />
}
