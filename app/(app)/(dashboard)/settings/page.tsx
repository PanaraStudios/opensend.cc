import { redirect } from "next/navigation"

/* Settings opens on the team: there is no overview page of its own. */
export default function SettingsPage() {
  redirect("/settings/team")
}
