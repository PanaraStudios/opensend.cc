import type { Metadata } from "next"

import { SettingsTeam } from "@/components/dashboard/settings"

export const metadata: Metadata = {
  title: "Team",
}

export default function SettingsTeamPage() {
  return <SettingsTeam />
}
