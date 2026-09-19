/** What every browser can decode into a bitmap. */
export const AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]
const AVATAR_MAX_BYTES = 1024 * 1024
/* Twice the largest size it is shown at. */
const AVATAR_SIZE = 160

/** An uploaded picture as a small square data URL: it is kept with the rest
    of the team, so it has to be light. Rejects with what is wrong. */
export async function readAvatar(file: File): Promise<string> {
  if (!AVATAR_TYPES.includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP or GIF image")
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error("Maximum file size is 1MB")
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image could not be read")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext("2d")!
  /* JPEG has no transparency, so a see-through image sits on white. */
  context.fillStyle = "#fff"
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  /* Cropped to its centre square. */
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE
  )
  bitmap.close()
  /* A browser that cannot write WebP answers with PNG, which is several
     times the size; JPEG is written everywhere. */
  const webp = canvas.toDataURL("image/webp", 0.85)
  return webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/jpeg", 0.85)
}
