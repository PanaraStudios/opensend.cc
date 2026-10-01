import { test } from "node:test"
import assert from "node:assert/strict"
import {
  gatewaySdp,
  metaSdp,
  opusOnly,
  validateIceRuntime,
  validateSdp,
} from "../src/sdp.js"
import { offer, answer } from "./fixtures.js"

test("complete mono-track Opus SDP with CRLF, one SSRC and DTLS fingerprint", () => {
  validateSdp(offer, { side: "meta", type: "offer" })
  validateSdp(answer, { side: "gateway", type: "answer" })
  assert.equal(gatewaySdp(answer, "answer"), opusOnly(answer))
})
test("codec munging removes G711 and trickle while retaining 8 kHz IVR DTMF", () => {
  const mixed =
    offer.replace("SAVPF 111", "SAVPF 111 0 126") +
    "a=rtpmap:0 PCMU/8000\r\na=rtpmap:126 telephone-event/8000\r\na=fmtp:126 0-16\r\na=rtcp-fb:0 nack\r\na=ice-options:trickle\r\n"
  const normalized = metaSdp(mixed.replaceAll("\r\n", "\n"), "offer")
  assert.doesNotMatch(normalized, /PCMU|ice-options|rtcp-fb:0/)
  assert.match(normalized, /telephone-event\/8000/)
  assert.match(normalized, /fmtp:126 0-16/)
  validateSdp(normalized, { side: "meta", type: "offer" })
})
for (const [name, invalid] of [
  ["multiple m-lines", offer + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n"],
  ["video-only", offer.replace("m=audio", "m=video")],
  ["rejected audio", offer.replace("audio 40000", "audio 0")],
  ["Opus wrong clock", offer.replace("opus/48000", "opus/16000")],
  ["ptime 40", offer.replace("ptime:20", "ptime:40")],
  ["missing fingerprint", offer.replace(/^a=fingerprint:.*\r\n/m, "")],
  ["invalid fingerprint", offer.replace("sha-256", "sha-1")],
  ["no candidates", offer.replace(/^a=candidate:.*\r\n/m, "")],
  [
    "bad candidate",
    offer.replace("127.0.0.1 40000 typ", "host.local 40000 typ"),
  ],
  ["missing ICE password", offer.replace(/^a=ice-pwd:.*\r\n/m, "")],
  ["DTLS client peer", offer.replace("setup:actpass", "setup:active")],
  ["multi SSRC", offer + "a=ssrc:2 cname:second\r\n"],
  ["ICE-full Meta peer", offer.replace("a=ice-lite\r\n", "")],
] as const)
  test(`rejects ${name}`, () => assert.throws(() => metaSdp(invalid, "offer")))
test("strict validation rejects trickle and an incomplete local SDP", () => {
  assert.throws(() =>
    validateSdp(answer + "a=ice-options:trickle\r\n", {
      side: "gateway",
      type: "answer",
    })
  )
  assert.throws(() =>
    validateSdp(answer.replace("a=end-of-candidates\r\n", ""), {
      side: "gateway",
      type: "answer",
    })
  )
  assert.throws(() =>
    validateSdp(answer + "a=ice-lite\r\n", { side: "gateway", type: "answer" })
  )
  assert.throws(() =>
    validateSdp(answer.replaceAll("\r\n", "\n"), {
      side: "gateway",
      type: "answer",
    })
  )
})
test("only runtime state proves ICE-full controlling; SDP cannot prove it", () => {
  validateIceRuntime({ "ice-mode": "full", "ice-role": "controlling" })
  assert.throws(() =>
    validateIceRuntime({ "ice-mode": "full", "ice-role": "controlled" })
  )
  assert.throws(() =>
    validateIceRuntime({ "ice-mode": "lite", "ice-role": "controlling" })
  )
})
test("outbound answer requires a passive DTLS peer, and preserves ICE credentials", () => {
  const passive = offer.replace("setup:actpass", "setup:passive")
  assert.match(metaSdp(passive, "answer"), /a=ice-pwd:123456789012345678901234/)
  assert.throws(() => metaSdp(offer, "answer"))
})
