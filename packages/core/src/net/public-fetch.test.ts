import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { ServerResponse } from "node:http"
import { publicFetch } from "./public-fetch"

test("streaming returns headers before the body ends, bounds bytes, and propagates failures", async () => {
  let pending: ServerResponse | undefined
  const server = createServer((req, response) => {
    if (req.url === "/large") {
      response.end("too large")
      return
    }
    pending = response
    response.write("first")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const response = await publicFetch(`${origin}/stream`, {
      localOrigin: origin,
      stream: true,
      maxBytes: 10,
      timeoutMs: 10_000,
    })
    assert.ok(pending)
    assert.equal(pending.writableEnded, false)
    const reader = response.body!.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value), "first")
    pending.end("last")
    assert.equal(new TextDecoder().decode((await reader.read()).value), "last")
    assert.equal((await reader.read()).done, true)
    const large = await publicFetch(`${origin}/large`, {
      localOrigin: origin,
      stream: true,
      maxBytes: 4,
    })
    await assert.rejects(large.arrayBuffer(), /too large/)
    await assert.rejects(
      publicFetch(`${origin}/stream`, { stream: true }),
      /public HTTPS/
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
