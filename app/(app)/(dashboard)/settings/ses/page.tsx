import { redirect } from "next/navigation"
import { SES_SETTINGS_PAGE } from "@/lib/dashboard/nav"

export default function SettingsSesRedirect() {
  redirect(SES_SETTINGS_PAGE.href)
}
