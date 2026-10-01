"use client"
import * as React from "react"
import type { Id } from "@/convex/_generated/dataModel"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { useFileUpload } from "@/lib/storage/use-upload"
import type { StorageUse } from "@/lib/storage/policy"
import { actionError } from "@/lib/action-error"

export function FileUploadField({
  label = "Upload file",
  use,
  from,
  disabled,
  onUploaded,
}: {
  label?: string
  use: StorageUse
  from?: string
  disabled?: boolean
  onUploaded: (id: Id<"storedFiles">, file: File) => void
}) {
  const upload = useFileUpload()
  const [busy, setBusy] = React.useState(false)
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="file"
        aria-label={label}
        disabled={disabled || busy}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setBusy(true)
          try {
            onUploaded(await upload(file, { use, from }), file)
          } catch (e) {
            toast.add({ type: "error", title: actionError(e) })
          } finally {
            setBusy(false)
          }
        }}
      />
      <FieldDescription>
        {busy
          ? "Uploading…"
          : "Local storage allows up to 20 MB. S3-compatible storage supports the limit for each file type."}
      </FieldDescription>
    </Field>
  )
}
