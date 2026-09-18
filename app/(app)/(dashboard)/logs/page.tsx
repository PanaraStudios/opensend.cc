import type { Metadata } from "next"
import { Suspense } from "react"

import { LogsView } from "@/components/dashboard/logs/list"

export const metadata: Metadata = {
  title: "Logs",
}

export default function LogsPage() {
  return (
    <Suspense>
      <LogsView />
    </Suspense>
  )
}
