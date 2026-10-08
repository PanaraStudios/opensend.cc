import type { Metadata } from "next"
import { FileStorageSettings } from "@/components/dashboard/file-storage"
import { TelemetrySettings } from "@/components/dashboard/settings-telemetry"

export const metadata: Metadata = { title: "Instance settings" }

export default function InstanceGeneralPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <FileStorageSettings />
      <TelemetrySettings />
    </div>
  )
}
