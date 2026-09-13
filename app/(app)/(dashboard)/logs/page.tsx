import type { Metadata } from "next"

import { LogsView } from "@/components/dashboard/emails"

export const metadata: Metadata = {
  title: "Logs",
}

export default function LogsPage() {
  return <LogsView />
}
