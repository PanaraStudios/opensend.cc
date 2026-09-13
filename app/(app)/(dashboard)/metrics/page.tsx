import type { Metadata } from "next"

import { MetricsView } from "@/components/dashboard/metrics"

export const metadata: Metadata = {
  title: "Metrics",
}

export default function MetricsPage() {
  return <MetricsView />
}
