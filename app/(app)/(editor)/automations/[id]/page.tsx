import type { Metadata } from "next"

import { AutomationBuilder } from "@/components/dashboard/automations/builder"

export const metadata: Metadata = {
  title: "Automation",
}

export default function AutomationBuilderPage() {
  return <AutomationBuilder />
}
