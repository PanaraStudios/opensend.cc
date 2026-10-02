"use client"

import * as React from "react"
import { FileIcon, UploadIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { useFileUpload } from "@/lib/storage/use-upload"
import {
  formatUploadSize,
  uploadAccept,
  uploadHint,
  type StorageUse,
} from "@/lib/storage/policy"
import { actionError } from "@/lib/action-error"

export function FileUploadField({
  label = "Upload file",
  use,
  from,
  disabled,
  accept,
  required = false,
  onUploaded,
  onRemoved,
  onUploadingChange,
}: {
  label?: string
  use: StorageUse
  from?: string
  disabled?: boolean
  accept?: string
  required?: boolean
  onUploaded: (id: Id<"storedFiles">, file: File) => void
  onRemoved?: () => void
  onUploadingChange?: (uploading: boolean) => void
}) {
  const upload = useFileUpload()
  const id = React.useId()
  const input = React.useRef<HTMLInputElement>(null)
  const pending = React.useRef<AbortController | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [status, setStatus] = React.useState<
    "idle" | "uploading" | "done" | "error"
  >("idle")
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string>()
  const [dragging, setDragging] = React.useState(false)
  const busy = status === "uploading"
  const hint = uploadHint(use)

  React.useEffect(() => () => pending.current?.abort(), [])

  async function choose(next: File) {
    if (disabled || pending.current) return
    onRemoved?.()
    setFile(next)
    setProgress(0)
    setError(undefined)
    setStatus("uploading")
    const controller = new AbortController()
    pending.current = controller
    onUploadingChange?.(true)
    try {
      const fileId = await upload(next, {
        use,
        from,
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (controller.signal.aborted) return
      setStatus("done")
      onUploaded(fileId, next)
    } catch (e) {
      if (controller.signal.aborted) return
      setStatus("error")
      setError(actionError(e))
    } finally {
      if (pending.current === controller) pending.current = null
      if (!controller.signal.aborted) onUploadingChange?.(false)
    }
  }

  function remove() {
    pending.current?.abort()
    pending.current = null
    onUploadingChange?.(false)
    onRemoved?.()
    setFile(null)
    setStatus("idle")
    setProgress(0)
    setError(undefined)
    if (input.current) input.current.value = ""
  }

  return (
    <Field data-invalid={status === "error"} data-disabled={disabled}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? " (required)" : ""}
      </FieldLabel>
      <input
        ref={input}
        id={id}
        type="file"
        hidden
        aria-label={label}
        aria-invalid={status === "error"}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        accept={accept ?? uploadAccept(use)}
        aria-required={required}
        disabled={disabled || busy}
        onChange={(event) => {
          const next = event.target.files?.[0]
          event.target.value = ""
          if (next) void choose(next)
        }}
      />
      {file ? (
        <>
          <Attachment state={status} className="w-full">
            <AttachmentMedia>
              <FileIcon aria-hidden="true" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
              <AttachmentDescription>
                {formatUploadSize(file.size)}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              {status === "error" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void choose(file)}
                >
                  Retry
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() => input.current?.click()}
              >
                Replace
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={remove}
              >
                Remove
              </Button>
            </AttachmentActions>
            {busy ? (
              <Progress
                value={progress}
                className="w-full"
                aria-label={`Uploading ${file.name}`}
              >
                <ProgressLabel>
                  <span className="flex items-center gap-2">
                    <Spinner aria-hidden="true" />
                    {progress === 100 ? "Finishing…" : "Uploading…"}
                  </span>
                </ProgressLabel>
                <ProgressValue>{() => `${progress}%`}</ProgressValue>
              </Progress>
            ) : status === "done" ? (
              <AttachmentDescription role="status" className="w-full">
                Done
              </AttachmentDescription>
            ) : null}
          </Attachment>
          <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
        </>
      ) : (
        <Attachment
          state="idle"
          data-dragging={dragging}
          data-disabled={disabled}
          className="w-full flex-col items-center justify-center gap-2 p-6 data-[disabled=true]:opacity-50 data-[dragging=true]:border-ring data-[dragging=true]:bg-muted/50"
          onDragOver={(event) => {
            event.preventDefault()
            if (disabled) return
            event.dataTransfer.dropEffect = "copy"
            setDragging(true)
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const next = event.dataTransfer.files[0]
            if (next) void choose(next)
          }}
        >
          <AttachmentTrigger
            aria-label={`Browse ${label.toLowerCase()}`}
            aria-describedby={`${id}-hint`}
            disabled={disabled}
            onClick={() => input.current?.click()}
          />
          <UploadIcon
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
          <span>
            Drop a file or{" "}
            <strong className="underline underline-offset-4">browse</strong>
          </span>
          <FieldDescription id={`${id}-hint`} className="text-center">
            {hint}
          </FieldDescription>
        </Attachment>
      )}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  )
}
