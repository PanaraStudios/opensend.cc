import type { Metadata } from "next"

import { SegmentDetail } from "@/components/dashboard/segments"

export const metadata: Metadata = {
  title: "Segment",
}

export default function SegmentDetailPage() {
  return <SegmentDetail />
}
