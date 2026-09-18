import type { Metadata } from "next"

import { DomainDetail } from "@/components/dashboard/domains/detail"

export const metadata: Metadata = {
  title: "Domain",
}

export default function DomainDetailPage() {
  return <DomainDetail />
}
