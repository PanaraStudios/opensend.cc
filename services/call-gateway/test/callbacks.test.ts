import { test } from "node:test"
import assert from "node:assert/strict"
import { ConvexCallbacks } from "../src/callbacks.js"
import { HmacVerifier } from "../src/auth.js"
import type { GatewayCallback } from "../src/contracts.js"

test("callback retries keep eventId, refresh nonce, and sign the configured Convex path", async () => {
  const secret = "s".repeat(64),
    verifier = new HmacVerifier(secret),
    received: GatewayCallback[] = []
  const send: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://convex:3211/calling/gateway/events")
    verifier.verify(
      "POST",
      "/calling/gateway/events",
      init!.body as string,
      init!.headers as Record<string, string>
    )
    received.push(JSON.parse(init!.body as string))
    return new Response("", { status: received.length === 1 ? 503 : 200 })
  }
  await new ConvexCallbacks("http://convex:3211/", secret, send).emit("call", {
    event: "media_up",
  })
  assert.equal(received.length, 2)
  assert.deepEqual(received[0], received[1])
  assert.equal(received[0].version, 1)
  assert.equal(received[0].callId, "call")
  assert.equal(received[0].event, "media_up")
})
