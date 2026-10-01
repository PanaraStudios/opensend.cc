"use client"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { DetailField, SettingsCard } from "./primitives"

export function FileStorageSettings() {
  const storage = useQuery(api.storage.files.settings)
  return (
    <SettingsCard title="File storage">
      <dl>
        <DetailField label="Provider">
          {!storage
            ? "Loading…"
            : storage.provider === "object"
              ? `S3-compatible · ${storage.bucket} · ${storage.host}`
              : "Local (Convex)"}
        </DetailField>
      </dl>
    </SettingsCard>
  )
}
