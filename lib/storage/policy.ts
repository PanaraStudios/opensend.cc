import { whatsappMediaLimit } from "../meta/media"

export const LOCAL_UPLOAD_LIMIT = 20 * 1024 * 1024
export const UPLOAD_TTL = 15 * 60_000
export const STORAGE_USES = [
  "whatsapp",
  "template",
  "email",
  "asset",
  "import",
] as const
export type StorageUse = (typeof STORAGE_USES)[number]
export const normalizeContentType = (value: string) =>
  value.trim().toLowerCase()

/** All segments come from server identities/enums, never filenames or paths. */
export function objectKey(
  team: string,
  feature: string,
  id: string,
  now = Date.now()
) {
  for (const segment of [team, feature, id])
    if (!/^[a-zA-Z0-9_-]+$/.test(segment))
      throw new Error("Invalid storage key segment")
  const date = new Date(now)
  return `teams/${team}/${feature}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${id}`
}

export function validateUpload(
  input: {
    use: StorageUse
    contentType: string
    size: number
    animated?: boolean
  },
  object: boolean
) {
  const { use, contentType, size } = input
  if (!contentType || contentType.length > 256 || /[\r\n]/.test(contentType))
    throw new Error("Invalid content type")
  let limit =
    use === "whatsapp" || use === "template"
      ? whatsappMediaLimit(contentType, input.animated)
      : use === "email"
        ? 30 * 1024 * 1024
        : LOCAL_UPLOAD_LIMIT
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
  if (!object) limit = Math.min(limit, LOCAL_UPLOAD_LIMIT)
  if (!Number.isSafeInteger(size) || size < 1 || size > limit)
    throw new Error(
      !object && size > LOCAL_UPLOAD_LIMIT
        ? "Local (Convex) uploads are limited to 20 MB. Configure S3-compatible storage for larger files."
        : `File must contain 1 to ${limit} bytes for this use`
    )
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
