/** Hand the browser a generated file under its own name. */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/** How long the frame stays: long enough for the response headers to turn
    it into a download, which then runs on without it. */
const FRAME_KEPT = 60_000

/** Starts a download the server names itself (`Content-Disposition`) in a
    hidden frame. Unlike following a link, an error page from the server
    loads out of sight instead of replacing the app. */
export function downloadFromUrl(
  url: string,
  doc: Pick<Document, "createElement" | "body"> = document,
  later: (run: () => void, ms: number) => unknown = setTimeout
) {
  const frame = doc.createElement("iframe")
  frame.style.display = "none"
  frame.src = url
  doc.body.appendChild(frame)
  later(() => frame.remove(), FRAME_KEPT)
}
