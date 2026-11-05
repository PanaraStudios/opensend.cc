/** An HTTP action response is capped at 100 MiB; each downloaded file stays
    under this so the streamed response never reaches the cap. */
export const VOLUME_BYTES = 90 * 1024 * 1024

/** A downloadable file: parts `[from, to)`, with the header line prepended
    to every file after the first so each one opens as a CSV on its own. */
export type ExportVolume = { from: number; to: number; bytes: number }

/** Groups consecutive parts into files of at most `limit` bytes (a single
    part larger than the limit still gets a file of its own). */
export function exportVolumes(
  parts: readonly { bytes: number }[],
  headerBytes: number,
  limit = VOLUME_BYTES
): ExportVolume[] {
  const volumes: ExportVolume[] = []
  let current: ExportVolume | null = null
  parts.forEach((part, index) => {
    if (current && current.bytes + part.bytes <= limit) {
      current.to = index + 1
      current.bytes += part.bytes
      return
    }
    current = {
      from: index,
      to: index + 1,
      bytes: part.bytes + (index === 0 ? 0 : headerBytes),
    }
    volumes.push(current)
  })
  return volumes
}

/** `contacts-1790557161016.csv` → `contacts-1790557161016-part-2-of-3.csv`. */
export function volumeFileName(fileName: string, volume: number, of: number) {
  if (of <= 1) return fileName
  return `${fileName.replace(/\.csv$/, "")}-part-${volume + 1}-of-${of}.csv`
}
