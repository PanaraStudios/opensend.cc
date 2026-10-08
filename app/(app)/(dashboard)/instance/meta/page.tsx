import type { Metadata } from "next"
import { SettingsMeta } from "@/components/dashboard/settings-meta"

export const metadata: Metadata = { title: "Meta app" }

export default function InstallationMetaPage() {
  return <SettingsMeta />
}
