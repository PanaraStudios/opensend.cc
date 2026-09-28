import type { Metadata } from "next"
import { ExportDetail } from "@/components/dashboard/exports/detail"

export const metadata: Metadata = { title: "Export" }

export default function ExportDetailPage() {
  return <ExportDetail />
}
