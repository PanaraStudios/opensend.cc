import type { Metadata } from "next"

import { DomainsView } from "@/components/dashboard/domains/list"

export const metadata: Metadata = {
  title: "Domains",
}

export default function DomainsPage() {
  return <DomainsView />
}
