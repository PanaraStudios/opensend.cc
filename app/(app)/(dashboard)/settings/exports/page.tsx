import type { Metadata } from "next"

import { SettingsExports } from "@/components/dashboard/settings"

export const metadata: Metadata = {
  title: "Exports",
}

export default function ExportsPage() {
  return <SettingsExports />
}
