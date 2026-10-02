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

const KB = 1024
const MB = KB * KB
const LIMITS = {
  email: 30 * MB,
  ivr: 16 * MB,
  template: 16 * MB,
  import: 256 * KB,
  asset: MB,
} as const
const TYPES = {
  ivr: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg"],
  template: ["image/jpeg", "image/png", "video/mp4", "application/pdf"],
  import: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  asset: ["image/png", "image/jpeg", "image/webp", "image/gif"],
} as const

export function formatUploadSize(size: number) {
  if (size > 0 && size < KB) return "<1 KB"
  const unit = size >= MB ? MB : KB
  return `${Number((size / unit).toFixed(1))} ${unit === MB ? "MB" : "KB"}`
}

export function uploadHint(use: StorageUse) {
  switch (use) {
    case "whatsapp":
      return `Images up to ${formatUploadSize(whatsappMediaLimit("image/jpeg"))} · video and audio up to ${formatUploadSize(whatsappMediaLimit("video/mp4"))} · documents up to ${formatUploadSize(whatsappMediaLimit("application/pdf"))}`
    case "template":
      return `JPEG, PNG, MP4 or PDF up to ${formatUploadSize(LIMITS.template)}`
    case "email":
      return `Up to ${formatUploadSize(LIMITS.email)}`
    case "ivr":
      return `WAV, MP3 or OGG, up to ${formatUploadSize(LIMITS.ivr)}`
    case "import":
      return `CSV up to ${formatUploadSize(LIMITS.import)}`
    case "asset":
      return `PNG, JPEG, WebP or GIF up to ${formatUploadSize(LIMITS.asset)}`
  }
}

export function uploadAccept(use: StorageUse) {
  if (use === "whatsapp" || use === "email") return undefined
  return TYPES[use].join(",")
}

export function validateUpload(input: {
  use: StorageUse
  contentType: string
  size: number
  animated?: boolean
}) {
  const { use, size } = input
  if (
    !input.contentType.trim() ||
    input.contentType.length > 256 ||
    /[\r\n]/.test(input.contentType)
  )
    throw new Error("Invalid file type.")
  const contentType = normalizeContentType(input.contentType)
  const mime = contentType.split(";")[0].trim()
  if (
    use !== "whatsapp" &&
    use !== "email" &&
    !(TYPES[use] as readonly string[]).includes(mime)
  ) {
    const messages = {
      ivr: "Upload a WAV, MP3 or OGG IVR prompt.",
      template: "Use a JPEG, PNG, MP4 or PDF template sample.",
      import: "Upload a CSV file.",
      asset: "Upload a PNG, JPEG, WebP or GIF image.",
    }
    throw new Error(messages[use])
  }
  const mediaLimit =
    use === "whatsapp" || use === "template"
      ? whatsappMediaLimit(contentType, input.animated)
      : undefined
  const limit =
    use === "whatsapp"
      ? mediaLimit!
      : use === "template"
        ? Math.min(mediaLimit!, LIMITS.template)
        : LIMITS[use]
  const kind =
    mime === "image/webp"
      ? "stickers"
      : mime.startsWith("image/")
        ? "images"
        : mime.startsWith("video/")
          ? "videos"
          : mime.startsWith("audio/")
            ? "audio files"
            : "documents"
  const description =
    use === "whatsapp"
      ? `WhatsApp ${kind}`
      : use === "template"
        ? `Template ${kind}`
        : use === "email"
          ? "Email attachments"
          : use === "ivr"
            ? "IVR audio files"
            : use === "import"
              ? "CSV files"
              : "Asset images"
  if (!Number.isSafeInteger(size) || size < 1)
    throw new Error(`Choose a non-empty file for ${description.toLowerCase()}.`)
  if (size > limit)
    throw new Error(`${description} can be up to ${formatUploadSize(limit)}.`)
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
