"use client"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { DetailField, SettingsCard } from "./primitives"

export function FileStorageSettings() {
  const storage = useQuery(api.storage.files.settings)
  return (
    <SettingsCard
      title="File storage"
      description="Files use the Convex backend’s configured storage: local disk or its built-in S3-compatible backend."
    >
      <dl>
        <DetailField label="Provider">
          {storage ? "Convex storage" : "Loading…"}
        </DetailField>
      </dl>
    </SettingsCard>
  )
}
