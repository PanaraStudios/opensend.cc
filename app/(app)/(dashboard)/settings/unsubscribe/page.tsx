import type { Metadata } from "next"

import { SettingsUnsubscribe } from "@/components/dashboard/settings"

export const metadata: Metadata = {
  title: "Unsubscribe page",
}

export default function UnsubscribePage() {
  return <SettingsUnsubscribe />
}
