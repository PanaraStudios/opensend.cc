import type { Metadata } from "next"

import { SettingsSes } from "@/components/dashboard/settings-ses"

export const metadata: Metadata = {
  title: "Amazon SES",
}

export default function SettingsSesPage() {
  return <SettingsSes />
}
