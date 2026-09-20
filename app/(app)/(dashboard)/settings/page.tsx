import { redirect } from "next/navigation"

import { SETTINGS_NAV_INDEX } from "@/lib/dashboard/nav"

/* Settings opens on the team: there is no overview page of its own. */
export default function SettingsPage() {
  redirect(SETTINGS_NAV_INDEX)
}
