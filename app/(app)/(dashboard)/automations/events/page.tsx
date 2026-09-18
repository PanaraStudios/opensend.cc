import type { Metadata } from "next"

import { AutomationEventsView } from "@/components/dashboard/automations/events"

export const metadata: Metadata = {
  title: "Events",
}

export default function AutomationEventsPage() {
  return <AutomationEventsView />
}
