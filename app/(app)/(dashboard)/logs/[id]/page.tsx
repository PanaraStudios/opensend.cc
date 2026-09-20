import type { Metadata } from "next"

import { LogDetail } from "@/components/dashboard/logs/detail"

export const metadata: Metadata = {
  title: "Log",
}

export default function LogDetailPage() {
  return <LogDetail />
}
