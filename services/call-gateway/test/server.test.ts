import { test } from "node:test"
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { createGatewayServer } from "../src/server.js"
import { CallGatewayClient } from "../src/client.js"
import { signRequest } from "../src/auth.js"
import type { GatewayApi } from "../src/contracts.js"

test("five plan endpoints round-trip through the signed client, and reject unsigned/malformed requests", async () => {
  const secret = "z".repeat(64),
    seen: unknown[] = []
  const api: GatewayApi = {
    inbound: async (sdp, id) => {
      seen.push(["inbound", sdp, id])
      return { answerSdp: "answer" }
    },
    outbound: async (id) => {
      seen.push(["outbound", id])
      return { offerSdp: "offer" }
    },
    remoteAnswer: async (id, sdp) => {
      seen.push(["remoteAnswer", id, sdp])
    },
    route: async (data) => {
      seen.push(["route", data])
    },
    hangup: async (id) => {
      seen.push(["hangup", id])
    },
    healthy: async () => true,
  }
  const server = createGatewayServer(api, secret)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = new CallGatewayClient(base, secret)
    assert.equal(await client.healthy(), true)
    assert.deepEqual(await client.inbound("remote", "id"), {
      answerSdp: "answer",
    })
    assert.deepEqual(await client.outbound("id2"), { offerSdp: "offer" })
    await client.remoteAnswer("id2", "answer")
    await client.route({ callId: "id", target: "ivr" })
    await client.hangup("id")
    assert.equal(seen.length, 5)
    const request = (body: string, headers: Record<string, string> = {}) =>
      fetch(`${base}/outbound`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      })
    assert.equal((await request('{"callId":"x"}')).status, 401)
    for (const body of [
      "broken",
      "[]",
      '{"callId":"x\\napi status"}',
      '{"callId":3}',
    ]) {
      const response = await request(
        body,
        signRequest(secret, "POST", "/outbound", body)
      )
      assert.equal(response.status, 400)
    }
    const body = '{"callId":"x"}',
      headers = signRequest(secret, "POST", "/outbound", body)
    assert.equal((await request(body, headers)).status, 200)
    assert.equal((await request(body, headers)).status, 401)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
