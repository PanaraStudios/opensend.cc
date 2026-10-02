import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import { transferUpload } from "./transfer"

class UploadRequest {
  static latest: UploadRequest
  upload: {
    onprogress?: (event: {
      lengthComputable: boolean
      loaded: number
      total: number
    }) => void
  } = {}
  onload = () => {}
  onerror = () => {}
  onabort = () => {}
  status = 200
  responseText = '{"storageId":"stored-document"}'
  method?: string
  url?: string
  contentType?: string
  body?: Blob

  constructor() {
    UploadRequest.latest = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    assert.equal(name, "Content-Type")
    this.contentType = value
  }
  send(body: Blob) {
    this.body = body
  }
  abort() {
    this.onabort()
  }
}

function mockRequest(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest")
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: UploadRequest,
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "XMLHttpRequest", previous)
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest")
  })
}

test("direct Convex transfer reports real progress and returns the storage id", async (t) => {
  mockRequest(t)
  const file = new Blob([new Uint8Array(100 * 1024 * 1024)], {
    type: "application/pdf",
  })
  const progress: number[] = []
  const result = transferUpload("https://storage.example/upload", file, {
    onProgress: (percent) => progress.push(percent),
  })
  const request = UploadRequest.latest
  assert.equal(request.method, "POST")
  assert.equal(request.url, "https://storage.example/upload")
  assert.equal(request.body, file)
  assert.equal(request.contentType, "application/pdf")
  request.upload.onprogress?.({
    lengthComputable: true,
    loaded: 21 * 1024 * 1024,
    total: file.size,
  })
  request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 })
  request.upload.onprogress?.({
    lengthComputable: true,
    loaded: file.size / 2,
    total: file.size,
  })
  request.onload()
  assert.equal(await result, "stored-document")
  assert.deepEqual(progress, [21, 50, 100])
})

test("HTTP, network and invalid response errors allow a fresh retry", async (t) => {
  mockRequest(t)
  const file = new Blob(["file"])
  const http = transferUpload("https://storage.example/upload", file)
  UploadRequest.latest.status = 413
  UploadRequest.latest.onload()
  await assert.rejects(http, /File upload failed/)
  const network = transferUpload("https://storage.example/upload", file)
  UploadRequest.latest.onerror()
  await assert.rejects(network, /Check your connection and retry/)
  for (const body of [
    "not JSON",
    "{}",
    '{"storageId":1}',
    '{"storageId":""}',
  ]) {
    const invalid = transferUpload("https://storage.example/upload", file)
    UploadRequest.latest.responseText = body
    UploadRequest.latest.onload()
    await assert.rejects(invalid, /Invalid file upload response/)
  }
  const retry = transferUpload("https://storage.example/upload", file)
  UploadRequest.latest.onload()
  assert.equal(await retry, "stored-document")
})

test("removal or unmount aborts an in-flight upload", async (t) => {
  mockRequest(t)
  const controller = new AbortController()
  const result = transferUpload(
    "https://storage.example/upload",
    new Blob(["file"]),
    { signal: controller.signal }
  )
  controller.abort()
  await assert.rejects(result, { name: "AbortError" })
  const lastRequest = UploadRequest.latest
  await assert.rejects(
    transferUpload("https://storage.example/upload", new Blob(["file"]), {
      signal: controller.signal,
    }),
    { name: "AbortError" }
  )
  assert.equal(UploadRequest.latest, lastRequest)
})
