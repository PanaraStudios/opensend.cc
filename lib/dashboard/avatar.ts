export const AVATAR_MAX_BYTES = 1024 * 1024
const AVATAR_SIZE = 256

/** An uploaded picture as a small square data URL: it is kept with the rest
    of the team, so it has to be light. Rejects with what is wrong. */
export async function readAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file")
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
  /* Cropped to its centre square. */
  canvas
    .getContext("2d")!
    .drawImage(
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
  return canvas.toDataURL("image/webp", 0.9)
}
