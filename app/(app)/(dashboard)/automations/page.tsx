import type { Metadata } from "next"

import { AutomationsView } from "@/components/dashboard/automations"

export const metadata: Metadata = {
  title: "Automations",
}

export default function AutomationsPage() {
  return <AutomationsView />
}
