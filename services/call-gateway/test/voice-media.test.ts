import assert from "node:assert/strict"
import { test } from "node:test"
import { encodeMuLaw, decodeMuLaw } from "../src/audio.js"
import { mediaOffer, rtpPayload } from "../src/voice-media.js"
import {
  VoiceBackend,
  VoiceTools,
  type VoiceToolRequest,
} from "../src/voice-backend.js"

test("PCMU preserves speech samples and media SDP prefers mono L16 with PCMU fallback", () => {
  for (const sample of [-20000, -2000, 0, 2000, 20000])
    assert.ok(Math.abs(decodeMuLaw(encodeMuLaw(sample)) - sample) < 700)
  const sdp =
    "v=0\r\nc=IN IP4 10.0.0.1\r\nm=audio 20400 RTP/AVP 0 97\r\na=rtpmap:97 L16/16000\r\na=ptime:20\r\n"
  assert.equal(mediaOffer(sdp).codec, "L16")
  assert.equal(mediaOffer(sdp.replace("0 97", "0")).codec, "PCMU")
  assert.throws(() =>
    mediaOffer(sdp.replace("L16/16000", "L16/16000/2").replace("0 97", "97"))
  )
  assert.throws(() => mediaOffer(sdp + "m=video 1234 RTP/AVP 96\r\n"))
  assert.throws(() => mediaOffer(sdp.replace("ptime:20", "ptime:40")))
  assert.equal(rtpPayload(Buffer.alloc(10), 97), undefined)
  const packet = Buffer.alloc(20)
  packet[0] = 0x90
  packet[1] = 97
  packet.writeUInt16BE(100, 14)
  assert.equal(
    rtpPayload(packet, 97),
    undefined,
    "Reject truncated RTP extension"
  )
})

test("tool requests capture team/call authority, deduplicate ids, reject injected scope, and abort on stop", async () => {
  const requests: VoiceToolRequest[] = []
  let signal!: AbortSignal
  const backend = new (class extends VoiceBackend {
    constructor() {
      super("http://unused", "s".repeat(64))
    }
    override async tool(request: VoiceToolRequest, abort: AbortSignal) {
      requests.push(request)
      signal = abort
      return { ok: true as const, result: { contactId: "fixture-contact" } }
    }
  })()
  const tools = new VoiceTools(backend, "call", "team")
  const tool = {
    id: "1",
    name: "lookup_contact",
    arguments: { query: "fixture" },
  }
  assert.deepEqual(await tools.run(tool), await tools.run(tool))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].organizationId, "team")
  assert.equal(requests[0].callId, "call")
  await assert.rejects(
    tools.run({ ...tool, arguments: { query: "changed" } }),
    /reused/
  )
  await assert.rejects(
    tools.run({
      ...tool,
      id: "2",
      arguments: { query: "fixture", organizationId: "evil" },
    }),
    /arguments/
  )
  await assert.rejects(
    tools.run({ ...tool, name: "arbitrary_webhook" }),
    /Invalid/
  )
  tools.stop()
  assert.equal(signal.aborted, true)
  await assert.rejects(tools.run({ ...tool, id: "3" }), /ended/)
})
