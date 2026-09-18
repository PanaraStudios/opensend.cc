import type { Metadata } from "next"

import { SegmentsView } from "@/components/dashboard/audience/segments"

export const metadata: Metadata = {
  title: "Segments",
}

export default function SegmentsPage() {
  return <SegmentsView />
}
