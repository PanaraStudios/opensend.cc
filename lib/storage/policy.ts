import { whatsappMediaLimit } from "../meta/media"

/** Application limit for the existing HTTP multipart route, not file storage. */
export const HTTP_MULTIPART_LIMIT = 20 * 1024 * 1024
export const UPLOAD_TTL = 15 * 60_000
export const STORAGE_USES = [
  "ivr",
  "whatsapp",
  "template",
  "email",
  "asset",
  "import",
] as const
export type StorageUse = (typeof STORAGE_USES)[number]
export const normalizeContentType = (value: string) =>
  value.trim().toLowerCase()

export function validateUpload(input: {
  use: StorageUse
  contentType: string
  size: number
  animated?: boolean
}) {
  const { use, contentType, size } = input
  if (!contentType || contentType.length > 256 || /[\r\n]/.test(contentType))
    throw new Error("Invalid content type")
  let limit =
    use === "whatsapp" || use === "template"
      ? whatsappMediaLimit(contentType, input.animated)
      : use === "email"
        ? 30 * 1024 * 1024
        : 1024 * 1024
  if (use === "ivr") {
    if (
      ![
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/ogg",
      ].includes(contentType.split(";")[0].trim().toLowerCase())
    )
      throw new Error("Upload a WAV, MP3 or OGG IVR prompt")
    limit = 16 * 1024 * 1024
  }
  if (use === "template") {
    if (
      !["image/jpeg", "image/png", "video/mp4", "application/pdf"].includes(
        contentType
      )
    )
      throw new Error("Use a JPEG, PNG, MP4 or PDF template sample")
    limit = Math.min(limit, 16 * 1024 * 1024)
  }
  if (use === "import") {
    if (
      !["text/csv", "text/plain", "application/vnd.ms-excel"].includes(
        contentType
      )
    )
      throw new Error("Upload a CSV file")
    limit = 256 * 1024
  }
  if (use === "asset") {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        contentType
      )
    )
      throw new Error("Upload a PNG, JPEG, WebP or GIF")
    limit = 1024 * 1024
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > limit)
    throw new Error(`File must contain 1 to ${limit} bytes for this use`)
}

export function verifyUpload(
  expected: { size: number; contentType: string },
  actual: { size: number; contentType: string }
) {
  if (expected.size !== actual.size)
    throw new Error("Uploaded file size does not match")
  if (
    normalizeContentType(expected.contentType) !==
    normalizeContentType(actual.contentType)
  )
    throw new Error("Uploaded file content type does not match")
}
