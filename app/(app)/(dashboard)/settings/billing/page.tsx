import type { Metadata } from "next"

import { SettingsBilling } from "@/components/dashboard/settings"

export const metadata: Metadata = {
  title: "Billing",
}

export default function BillingPage() {
  return <SettingsBilling />
}
