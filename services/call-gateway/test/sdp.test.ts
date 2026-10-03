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
test("accepts Meta's live offer, whose ice-pwd carries base64 padding", () => {
  // Captured from a real user-initiated WhatsApp call (2026-10-02).
  const live = [
    "v=0",
    "o=- 1790963543407 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE audio",
    "a=msid-semantic: WMS 7da83f2b-4810-4fe9-b568-5c88eb1b1724",
    "a=ice-lite",
    "m=audio 3480 UDP/TLS/RTP/SAVPF 111 126",
    "c=IN IP4 57.144.43.49",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=candidate:2275956755 1 udp 2122260223 57.144.43.49 3480 typ host generation 0 network-cost 50",
    "a=candidate:2684782176 1 udp 2122262783 2a03:2880:f312:131:face:b00c:0:699c 3480 typ host generation 0 network-cost 50",
    "a=ice-ufrag:NvPeRHRlBReaRYCZ",
    "a=ice-pwd:+219v9nKr3xSQIn8s+Fy8g==",
    "a=fingerprint:sha-256 75:85:02:48:2F:A1:97:65:81:65:4C:B3:2D:13:72:84:8F:D4:BE:31:6E:A0:71:34:52:C3:7A:28:76:43:C6:71",
    "a=setup:actpass",
    "a=mid:audio",
    "a=sendrecv",
    "a=msid:7da83f2b-4810-4fe9-b568-5c88eb1b1724 WhatsAppTrack1",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "a=rtcp-fb:111 transport-cc",
    "a=fmtp:111 maxaveragebitrate=20000;maxplaybackrate=16000;minptime=20;sprop-maxcapturerate=16000;useinbandfec=1",
    "a=rtpmap:126 telephone-event/8000",
    "a=maxptime:20",
    "a=ptime:20",
    "a=ssrc:613016344 cname:WhatsAppAudioStream1",
    "",
  ].join("\r\n")
  assert.match(metaSdp(live, "offer"), /a=ice-pwd:\+219v9nKr3xSQIn8s\+Fy8g==/)
})

test("outbound FreeSWITCH offers retain 8k DTMF alongside Opus, without L16 or 48k DTMF", () => {
  const mixed =
    answer.replace("SAVPF 111", "SAVPF 111 100 101 102") +
    "a=rtpmap:100 L16/8000\r\na=rtpmap:101 telephone-event/48000\r\na=rtpmap:102 telephone-event/8000\r\na=fmtp:102 0-16\r\n"
  const normalized = gatewaySdp(
    mixed.replace("setup:active", "setup:actpass"),
    "offer"
  )
  assert.match(normalized, /SAVPF 111 102\r\n/)
  assert.match(normalized, /telephone-event\/8000/)
  assert.doesNotMatch(normalized, /L16|telephone-event\/48000/)
})
