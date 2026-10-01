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

test("session endpoints are HMAC-protected and the XML directory requires its own secret", async () => {
  const { AgentSessions } = await import("../src/agents.js")
  const sessions = new AgentSessions()
  const secret = "g".repeat(64),
    directorySecret = "d".repeat(64)
  const api: GatewayApi = {
    inbound: async () => ({ answerSdp: "answer" }),
    outbound: async () => ({ offerSdp: "offer" }),
    remoteAnswer: async () => {},
    route: async () => {},
    hangup: async () => {},
    healthy: async () => true,
  }
  const server = createGatewayServer(api, secret, {
    sessions,
    directorySecret,
    sipSecret: "s".repeat(64),
    control: async () => {},
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = new CallGatewayClient(base, secret)
    const row = await client.agentSession("session-one")
    assert.match(row.extension, /^20\d{2}$/)
    assert.equal(
      (
        await fetch(`${base}/agents/session`, {
          method: "POST",
          body: JSON.stringify({ sessionId: "session-two" }),
          headers: { "content-type": "application/json" },
        })
      ).status,
      401
    )
    const request = (password = directorySecret) =>
      fetch(`${base}/agents/directory`, {
        method: "POST",
        body: new URLSearchParams({
          section: "directory",
          domain: "freeswitch",
          user: row.extension,
        }),
        headers: {
          authorization: `Basic ${Buffer.from(`directory:${password}`).toString("base64")}`,
        },
      })
    assert.equal((await request("wrong")).status, 401)
    assert.match(await (await request()).text(), new RegExp(row.password))
    await client.revokeAgent("session-one")
    assert.match(await (await request()).text(), /not found/)
    await assert.rejects(
      client.route({
        callId: "call",
        target: "agent",
        extension: row.extension,
      }),
      /expired/
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("signed routing retains IVR and bot resource ids through the HTTP boundary", async () => {
  const secret = "z".repeat(64),
    routes: unknown[] = []
  const api: GatewayApi = {
    inbound: async () => ({ answerSdp: "" }),
    outbound: async () => ({ offerSdp: "" }),
    remoteAnswer: async () => {},
    hangup: async () => {},
    healthy: async () => true,
    route: async (data) => {
      routes.push(data)
    },
  }
  const server = createGatewayServer(api, secret)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = new CallGatewayClient(base, secret)
    const ivr = { callId: "call", target: "ivr" as const, ivrId: "ivr-id" },
      bot = {
        callId: "call",
        target: "bot" as const,
        botId: "bot-id",
        organizationId: "team",
      }
    await client.route(ivr)
    await client.route(bot)
    assert.deepEqual(routes, [ivr, bot])
    const body = JSON.stringify({ callId: "call", target: "ivr", ivrId: 123 })
    const invalid = await fetch(`${base}/route`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...signRequest(secret, "POST", "/route", body),
      },
    })
    assert.equal(invalid.status, 400)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
