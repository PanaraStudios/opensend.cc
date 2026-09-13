import type { Metadata } from "next"

import { DomainsView } from "@/components/dashboard/domains"

export const metadata: Metadata = {
  title: "Domains",
}

export default function DomainsPage() {
  return <DomainsView />
}
