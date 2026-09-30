import type { Metadata } from "next"
import { SettingsMeta } from "@/components/dashboard/settings-meta"
import { PageHeader } from "@/components/dashboard/primitives"

export const metadata: Metadata = { title: "Meta app" }

export default function InstallationMetaPage() {
  return (
    <>
      <PageHeader title="Meta app" />
      <SettingsMeta />
    </>
  )
}
