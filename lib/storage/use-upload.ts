"use client"
import { useAction } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { StorageUse } from "./policy"
import { useWorkspace } from "@/components/auth/workspace"

/** Shared browser transfer for inbox, campaign media, attachments and assets. */
export function useFileUpload() {
  const { activeTeamId } = useWorkspace()
  const begin = useAction(api.storage.objects.createUpload)
  const complete = useAction(api.storage.objects.completeUpload)
  return async (
    file: File | Blob,
    input: {
      use: StorageUse
      from?: string
      filename?: string
      organizationId?: string
    }
  ) => {
    const organizationId = input.organizationId ?? activeTeamId
    if (!organizationId) throw new Error("Choose a team")
    const pending = await begin({
      organizationId,
      input: {
        use: input.use,
        from: input.from,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        filename:
          input.filename ?? (file instanceof File ? file.name : "attachment"),
        animated: file.type === "image/webp" ? true : undefined,
      },
    })
    const response = await fetch(pending.upload_url, {
      method: pending.provider === "object" ? "PUT" : "POST",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    })
    if (!response.ok) throw new Error("File upload failed")
    const storageId =
      pending.provider === "convex"
        ? (await response.json()).storageId
        : undefined
    return (await complete({ organizationId, id: pending.id, storageId })).id
  }
}
