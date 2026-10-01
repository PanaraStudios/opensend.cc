import { test } from "node:test"
import assert from "node:assert/strict"
import { HmacVerifier, signRequest } from "../src/auth.js"
const secret = "a".repeat(64),
  now = 1800000000000,
  body = '{"callId":"test"}'
const signed = () =>
  signRequest(secret, "POST", "/outbound", body, String(now / 1000))
test("authenticates exact raw bytes and rejects replay", () => {
  const verifier = new HmacVerifier(secret, () => now),
    headers = signed()
  verifier.verify("POST", "/outbound", body, headers)
  assert.throws(() => verifier.verify("POST", "/outbound", body, headers))
})
test("binds method, path, body, timestamp and nonce", () => {
  const verifier = new HmacVerifier(secret, () => now)
  for (const [method, path, raw] of [
    ["GET", "/outbound", body],
    ["POST", "/hangup", body],
    ["POST", "/outbound", body + " "],
  ])
    assert.throws(() => verifier.verify(method, path, raw, signed()))
  const headers = signed()
  headers["x-call-gateway-nonce"] = "changed-nonce-0000"
  assert.throws(() => verifier.verify("POST", "/outbound", body, headers))
  assert.throws(() => new HmacVerifier("too short"))
})
test("rejects stale, future, missing, array-valued and malformed credentials", () => {
  const verifier = new HmacVerifier(secret, () => now)
  for (const timestamp of [
    String(now / 1000 - 61),
    String(now / 1000 + 61),
    "garbage",
  ])
    assert.throws(() =>
      verifier.verify(
        "POST",
        "/outbound",
        body,
        signRequest(secret, "POST", "/outbound", body, timestamp)
      )
    )
  for (const headers of [
    {},
    { ...signed(), "x-call-gateway-signature": "sha256=x" },
    { ...signed(), "x-call-gateway-timestamp": [String(now / 1000)] },
  ])
    assert.throws(() => verifier.verify("POST", "/outbound", body, headers))
})
test("expires old nonce entries", () => {
  let clock = now
  const verifier = new HmacVerifier(secret, () => clock),
    nonce = "repeatable-nonce-1234"
  verifier.verify(
    "POST",
    "/outbound",
    body,
    signRequest(secret, "POST", "/outbound", body, String(clock / 1000), nonce)
  )
  clock += 61000
  verifier.verify(
    "POST",
    "/outbound",
    body,
    signRequest(secret, "POST", "/outbound", body, String(clock / 1000), nonce)
  )
})
