import type { Metadata } from "next"

import { EmailsView } from "@/components/dashboard/emails/lists"

export const metadata: Metadata = {
  title: "Emails",
}

export default function EmailsPage() {
  return <EmailsView />
}
