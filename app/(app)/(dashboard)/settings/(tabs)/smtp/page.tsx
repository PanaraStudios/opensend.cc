import type { Metadata } from "next"

import { SettingsSmtp } from "@/components/dashboard/settings"

export const metadata: Metadata = {
  title: "SMTP",
}

export default function SettingsSmtpPage() {
  return <SettingsSmtp />
}
