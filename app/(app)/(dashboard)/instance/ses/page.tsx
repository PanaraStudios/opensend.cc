import type { Metadata } from "next"
import { SettingsSes } from "@/components/dashboard/settings-ses"
import { PageHeader } from "@/components/dashboard/primitives"

export const metadata: Metadata = { title: "Amazon SES" }

export default function InstallationSesPage() {
  return (
    <>
      <PageHeader title="Amazon SES" />
      <SettingsSes />
    </>
  )
}
