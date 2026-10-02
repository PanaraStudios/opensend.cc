"use client"
import { useAction } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { validateUpload, type StorageUse } from "./policy"
import { transferUpload } from "./transfer"
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
      onProgress?: (percent: number) => void
      signal?: AbortSignal
    }
  ) => {
    const contentType = file.type || "application/octet-stream"
    const animated = contentType === "image/webp" ? true : undefined
    validateUpload({ use: input.use, contentType, size: file.size, animated })
    input.signal?.throwIfAborted()
    const organizationId = input.organizationId ?? activeTeamId
    if (!organizationId) throw new Error("Choose a team")
    const pending = await begin({
      organizationId,
      input: {
        use: input.use,
        from: input.from,
        size: file.size,
        contentType,
        filename:
          input.filename ?? (file instanceof File ? file.name : "attachment"),
        animated,
      },
    })
    const storageId = await transferUpload(pending.upload_url, file, {
      onProgress: input.onProgress,
      signal: input.signal,
    })
    input.signal?.throwIfAborted()
    const result = await complete({
      organizationId,
      id: pending.id,
      storageId: storageId as Id<"_storage">,
    })
    input.signal?.throwIfAborted()
    return result.id
  }
}
