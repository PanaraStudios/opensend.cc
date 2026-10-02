/** Send bytes directly to Convex storage, with browser upload progress. */
export function transferUpload(
  url: string,
  file: Blob,
  options: {
    onProgress?: (percent: number) => void
    signal?: AbortSignal
  } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"))
      return
    }
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    const cleanup = () => signal?.removeEventListener("abort", abort)
    request.open("POST", url)
    request.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    )
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress?.(
          Math.min(100, Math.round((event.loaded / event.total) * 100))
        )
    }
    request.onload = () => {
      cleanup()
      if (request.status < 200 || request.status >= 300) {
        reject(new Error("File upload failed. Please retry."))
        return
      }
      try {
        const response: unknown = JSON.parse(request.responseText)
        if (
          !response ||
          typeof response !== "object" ||
          !("storageId" in response) ||
          typeof response.storageId !== "string" ||
          !response.storageId
        )
          throw new Error("Invalid file upload response. Please retry.")
        onProgress?.(100)
        resolve(response.storageId)
      } catch {
        reject(new Error("Invalid file upload response. Please retry."))
      }
    }
    request.onerror = () => {
      cleanup()
      reject(new Error("File upload failed. Check your connection and retry."))
    }
    request.onabort = () => {
      cleanup()
      reject(new DOMException("Upload cancelled", "AbortError"))
    }
    signal?.addEventListener("abort", abort, { once: true })
    request.send(file)
  })
}
