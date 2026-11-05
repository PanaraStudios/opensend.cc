/** One `bytes=` range from an HTTP Range header, resolved against a file
    size (RFC 9110 §14). Media players need this to seek. Returns null when
    the whole file should be sent, and "unsatisfiable" for a 416. */
export function byteRange(
  header: string | null,
  size: number
): { start: number; end: number } | null | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "")
  if (!match || (!match[1] && !match[2])) return null
  let start: number
  let end: number
  if (!match[1]) {
    // A suffix range: the last N bytes.
    const length = Number(match[2])
    if (length === 0) return "unsatisfiable"
    start = Math.max(0, size - length)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }
  if (start >= size || start > end) return "unsatisfiable"
  return { start, end }
}
