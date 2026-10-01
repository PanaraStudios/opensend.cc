import { test } from "node:test"
import assert from "node:assert/strict"
import {
  callOptions,
  validateCallingSettings,
  validateSdp,
  callWireStatus,
} from "./calling"
import { verifyGatewayHmac } from "./calling-gateway"
import { signRequest } from "../../services/call-gateway/src/auth"
test("calling payload validation keeps opt-ins separate and replaces hours whole", () => {
  assert.deepEqual(
    callOptions({
      recording: { status: "DISABLED" },
      transcription: {
        status: "ENABLED",
        purpose: "Support",
        announcement_language: "en",
      },
    }),
    {
      recording: { status: "DISABLED" },
      transcription: {
        status: "ENABLED",
        purpose: "Support",
        announcement_language: "en",
      },
    }
  )
  assert.throws(
    () => callOptions({ recording: { status: "ENABLED" } }),
    /purpose/
  )
  assert.throws(
    () => callOptions({ biz_opaque_callback_data: "x".repeat(513) }),
    /512/
  )
  assert.throws(
    () => validateCallingSettings({ sip: { status: "ENABLED" } }),
    /SIP/
  )
  assert.throws(
    () =>
      validateCallingSettings({
        call_hours: {
          status: "ENABLED",
          timezone_id: "wrong",
          weekly_operating_hours: [],
        },
      }),
    /timezone/
  )
  const settings = {
    call_hours: {
      status: "ENABLED",
      timezone_id: "UTC",
      weekly_operating_hours: [],
    },
  }
  assert.deepEqual(validateCallingSettings(settings), settings)
  assert.equal(callWireStatus(["completed"]), "COMPLETED")
  assert.throws(() => validateSdp("v=0\nm=audio"), /CRLF/)
})
test("callback HMAC matches gateway client bytes and binds body/path/method/timestamp", async () => {
  const secret = "a".repeat(64),
    path = "/calling/gateway/events",
    body = '{"event":"media_up"}',
    bytes = new TextEncoder().encode(body),
    now = Date.now()
  const headers = signRequest(
    secret,
    "POST",
    path,
    body,
    Math.floor(now / 1000).toString()
  )
  const request = new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers,
    body,
  })
  assert.ok(await verifyGatewayHmac(secret, request, bytes, now))
  assert.equal(
    await verifyGatewayHmac(
      secret,
      request,
      new TextEncoder().encode(body + " "),
      now
    ),
    null
  )
  assert.equal(
    await verifyGatewayHmac(secret, request, bytes, now + 61000),
    null
  )
  assert.equal(
    await verifyGatewayHmac(
      secret,
      new Request("https://api.example.test/wrong", {
        method: "POST",
        headers,
        body,
      }),
      bytes,
      now
    ),
    null
  )
  assert.equal(
    await verifyGatewayHmac(
      secret,
      new Request(`https://api.example.test${path}?x=1`, {
        method: "POST",
        headers,
        body,
      }),
      bytes,
      now
    ),
    null
  )
})
