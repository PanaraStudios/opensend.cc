import { unzipSync, zipSync } from "fflate"
import { parse } from "parse5"
export async function extractKnowledgeText(
  bytes: Uint8Array,
  contentType: string,
  filename = ""
): Promise<string> {
  const mime = contentType.split(";")[0].toLowerCase().trim()
  if (mime === "application/pdf" || /\.pdf(?:$|\?)/i.test(filename)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
    // Bundle the worker explicitly: Convex actions do not retain package-relative files.
    const { WorkerMessageHandler } =
      // @ts-expect-error PDF.js publishes the worker without a type declaration.
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs")
    ;(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker =
      { WorkerMessageHandler }
    const task = getDocument({
      data: bytes,
      useSystemFonts: true,
      useWorkerFetch: false,
    })
    const pdf = await task.promise
    try {
      if (pdf.numPages > 200)
        throw new Error("PDFs may contain up to 200 pages")
      let text = ""
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n),
          content = await page.getTextContent()
        text +=
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ") + "\n"
        page.cleanup()
        if (text.length > 200000)
          throw new Error("Extracted PDF text exceeds 200,000 characters")
      }
      return text
    } finally {
      await task.destroy()
    }
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx(?:$|\?)/i.test(filename)
  ) {
    let expanded = 0,
      entries = 0
    const files = unzipSync(bytes, {
      filter: (file) => {
        expanded += file.originalSize
        if (++entries > 128 || expanded > 8 * 1024 * 1024)
          throw new Error("DOCX contents exceed the 8 MB expanded size limit")
        return true
      },
    })
    const actual = Object.values(files).reduce(
      (total, file) => total + file.length,
      0
    )
    if (actual > 8 * 1024 * 1024)
      throw new Error("DOCX contents exceed the 8 MB expanded size limit")
    // Rebuild the bounded archive before handing it to the pure-JS parser.
    const mammoth = await import("mammoth")
    return (
      await mammoth.extractRawText({ buffer: Buffer.from(zipSync(files)) })
    ).value
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    const root = parse(text)
    const read = (
      node: typeof root | (typeof root)["childNodes"][number]
    ): string => {
      if (
        "tagName" in node &&
        ["script", "style", "nav", "noscript"].includes(node.tagName)
      )
        return ""
      if ("value" in node) return node.value
      return "childNodes" in node ? node.childNodes.map(read).join(" ") : ""
    }
    return read(root).replace(/\s+/g, " ")
  }
  if (
    ![
      "text/plain",
      "text/markdown",
      "text/x-markdown",
      "application/octet-stream",
    ].includes(mime)
  )
    throw new Error("Use a PDF, TXT, Markdown, DOCX or HTML document")
  return text
}
