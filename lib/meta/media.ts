/** Official Cloud API media formats and limits:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/media-upload-api
 */
const MB = 1024 * 1024
export const MAX_WHATSAPP_MEDIA_BYTES = 100 * MB
const DOCUMENTS = [
  "text/plain",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]
export function whatsappMediaLimit(contentType: string, animated = false) {
  const mime = contentType.split(";")[0].trim().toLowerCase()
  if (["image/jpeg", "image/png"].includes(mime)) return 5 * MB
  if (
    [
      "video/mp4",
      "video/3gpp",
      "audio/aac",
      "audio/mp4",
      "audio/mpeg",
      "audio/amr",
    ].includes(mime)
  )
    return 16 * MB
  if (mime === "audio/ogg" && /codecs\s*=\s*"?opus"?/i.test(contentType))
    return 16 * MB
  if (mime === "image/webp") return (animated ? 500 : 100) * 1024
  if (DOCUMENTS.includes(mime)) return 100 * MB
  throw new Error(
    "Unsupported WhatsApp media MIME type (OGG requires codecs=opus)."
  )
}
export function validateWhatsAppMedia(bytes: Uint8Array, contentType: string) {
  // WebP's VP8X animation flag or ANIM chunk distinguishes animated stickers.
  const animated =
    contentType.split(";")[0] === "image/webp" &&
    (new TextDecoder().decode(bytes.subarray(12, 16)) === "ANIM" ||
      (new TextDecoder().decode(bytes.subarray(12, 16)) === "VP8X" &&
        (bytes[20] & 2) !== 0))
  const limit = whatsappMediaLimit(contentType, animated)
  if (!bytes.length || bytes.length > limit)
    throw new Error(`Media must contain 1 to ${limit} bytes for this type.`)
}

/** Generate multipart bytes without decoding the binary file. */
export function whatsappMediaMultipart(
  bytes: Uint8Array,
  contentType: string,
  filename: string,
  boundary: string
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(boundary))
    throw new Error("Invalid multipart boundary.")
  if (/[\r\n]/.test(contentType)) throw new Error("Invalid media MIME type.")
  const safeName = filename.replace(/[\r\n"\\]/g, "_")
  const encode = (text: string) => new TextEncoder().encode(text)
  const head = encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${contentType}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`
  )
  const tail = encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return {
    bytes: body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}
