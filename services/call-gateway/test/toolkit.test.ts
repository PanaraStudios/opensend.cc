import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { publicFetch } from "../src/net/public-fetch.js"
import { embedText } from "../src/voice/embedding.js"

test("embedding transport refuses redirects and bounds the response before JSON parsing", async () => {
  let redirected = 0
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(307, { location: "/target" }).end()
    } else if (request.url === "/target") {
      redirected++
      response.end("unexpected")
    } else {
      response.end(" ".repeat(64 * 1024 + 1))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const transport =
    (path: string): typeof publicFetch =>
    (_url, options) => {
      assert.equal(options?.timeoutMs, 10000)
      assert.equal(options?.maxBytes, 64 * 1024)
      return publicFetch(origin + path, { ...options, localOrigin: origin })
    }
  try {
    await assert.rejects(
      embedText(
        "fixture",
        "text",
        "RETRIEVAL_QUERY",
        undefined,
        transport("/redirect")
      ),
      /HTTP 307/
    )
    assert.equal(redirected, 0)
    await assert.rejects(
      embedText(
        "fixture",
        "text",
        "RETRIEVAL_QUERY",
        undefined,
        transport("/large")
      ),
      /Response body too large/
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
