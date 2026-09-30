import type { Metadata } from "next"
import { SettingsUsage } from "@/components/dashboard/settings-usage"

export const metadata: Metadata = { title: "Usage" }

export default function SettingsUsagePage() {
  return <SettingsUsage />
}
