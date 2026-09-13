import type { Metadata } from "next"

import { SettingsSso } from "@/components/dashboard/settings"

export const metadata: Metadata = {
  title: "Single Sign-On",
}

export default function SsoPage() {
  return <SettingsSso />
}
