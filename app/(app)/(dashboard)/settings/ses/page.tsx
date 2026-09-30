import { redirect } from "next/navigation"
import { INSTANCE_PAGES } from "@/lib/dashboard/nav"

export default function SettingsSesRedirect() {
  redirect(INSTANCE_PAGES[0].href)
}
