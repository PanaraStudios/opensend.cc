/** Docker-only harness; fake Meta/backend plus an optional real SIP.js browser. */
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpHeader,
  RtpPacket,
} from "werift"
import { chromium, type Browser, type Page } from "playwright"
import type { BrowserAgentState } from "./browser-agent.js"
import { HmacVerifier, signRequest } from "../src/auth.js"
import { CallGatewayClient } from "../src/client.js"
import type { GatewayCallback } from "../src/contracts.js"
import { metaSdp, validateIceRuntime, validateSdp } from "../src/sdp.js"

const secret = process.env.CALL_GATEWAY_SECRET ?? ""
const verifier = new HmacVerifier(secret)
const gateway = new CallGatewayClient(
  process.env.CALL_GATEWAY_URL ?? "http://call-gateway:8090",
  secret
)
const janusAdmin = process.env.JANUS_ADMIN_URL ?? "http://janus:7088/admin"
const callbacks: GatewayCallback[] = []
const receiver = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    // Fake authenticated Convex action: exercises the exact 8c HMAC issuance API.
    if (request.url === "/test/agent/session") {
      verifier.verify(request.method!, request.url, body, request.headers)
      const { sessionId } = JSON.parse(body) as { sessionId: string }
      const credential = await gateway.agentSession(sessionId)
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(credential))
      return
    }
    assert.equal(request.url, "/calling/gateway/events")
    verifier.verify(request.method!, request.url!, body, request.headers)
    const event = JSON.parse(body) as GatewayCallback
    assert.equal(event.version, 1)
    if (!callbacks.some((previous) => previous.eventId === event.eventId))
      callbacks.push(event)
    response.writeHead(200).end('{"ok":true}')
  } catch (error) {
    response.writeHead(401).end(String(error))
  }
})
await new Promise<void>((resolve) => receiver.listen(8091, "0.0.0.0", resolve))
const watchdog = setTimeout(() => {
  console.error("Harness exceeded 120 seconds")
  process.exit(1)
}, 120000).unref()

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeout = 15000
) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await predicate()) return
    await delay(50)
  }
  throw new Error(message)
}
async function admin(
  path: string,
  janus: string
): Promise<Record<string, unknown>> {
  const response = await fetch(`${janusAdmin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      janus,
      transaction: randomUUID(),
      admin_secret: process.env.JANUS_API_SECRET,
    }),
  })
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(response.status, 200)
  assert.notEqual(body.janus, "error")
  return body
}
async function infoFor(callId: string): Promise<Record<string, unknown>> {
  const sessions = (await admin("", "list_sessions")).sessions as number[]
  for (const session of sessions) {
    const handles = (await admin(`/${session}`, "list_handles"))
      .handles as number[]
    for (const handle of handles) {
      const info = (await admin(`/${session}/${handle}`, "handle_info"))
        .info as Record<string, unknown>
      // SIP call header correlation is retained by the core handle as opaque_id.
      if (info.opaque_id === callId) return info
    }
  }
  throw new Error(`Missing Janus handle for ${callId}`)
}

async function browserAgent() {
  const sessionId = `harness-agent-${randomUUID()}`
  const body = JSON.stringify({ sessionId })
  const response = await fetch("http://127.0.0.1:8091/test/agent/session", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...signRequest(secret, "POST", "/test/agent/session", body),
    },
  })
  assert.equal(response.status, 200)
  const credential = (await response.json()) as {
    extension: string
    password: string
  }
  const asset = await readFile("/app/agent.js")
  const web = createServer((request, response) => {
    if (request.url === "/agent.js")
      response.setHeader("content-type", "text/javascript").end(asset)
    else
      response
        .setHeader("content-type", "text/html")
        .end('<script src="/agent.js"></script>')
  })
  await new Promise<void>((resolve) => web.listen(8092, "127.0.0.1", resolve))
  let browser: Browser | undefined
  let page: Page | undefined
  try {
    browser = await chromium.launch({
      executablePath: "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--ignore-certificate-errors",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    })
    page = await browser.newPage()
    await page.goto("http://127.0.0.1:8092")
    await page.evaluate((row) => window.agent.start(row), credential)
    await page.waitForFunction(() => window.agent.state.registered, null, {
      timeout: 15000,
    })
    console.log(
      "PASS agent registration: backend-issued ephemeral credential, XML-CURL directory, SIP.js over WSS"
    )
    const currentPage = page
    return {
      extension: credential.extension,
      stats: () => currentPage.evaluate(() => window.agent.stats()),
      async close() {
        await currentPage
          .evaluate(() => window.agent.stop())
          .catch(() => undefined)
        await gateway.revokeAgent(sessionId)
        try {
          await currentPage.evaluate(
            (row) => window.agent.start(row),
            credential
          )
          await currentPage.waitForFunction(
            () => window.agent.state.error || window.agent.state.registered,
            null,
            { timeout: 15000 }
          )
          const state = await currentPage.evaluate(() => window.agent.state)
          assert.equal(
            state.registered,
            false,
            "Revoked credential still registered through a directory fallback/cache"
          )
          assert.match(state.error ?? "", /Registration rejected/)
          console.log(
            "PASS agent revocation: old credential rejected by FreeSWITCH; no static/cache fallback"
          )
        } finally {
          await currentPage
            .evaluate(() => window.agent.stop())
            .catch(() => undefined)
          await browser?.close()
          await new Promise<void>((resolve) => web.close(() => resolve()))
        }
      },
    }
  } catch (error) {
    await browser?.close()
    await gateway.revokeAgent(sessionId)
    await new Promise<void>((resolve) => web.close(() => resolve()))
    throw error
  }
}

async function run(
  direction: "inbound" | "outbound",
  agent?: Awaited<ReturnType<typeof browserAgent>>
) {
  const callId = `harness-${direction}-${randomUUID()}`
  const peer = new RTCPeerConnection({
    iceLite: true,
    iceServers: [],
    iceUseIpv6: false,
    iceUseTcp: false,
    codecs: {
      audio: [
        new RTCRtpCodecParameters({
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
          payloadType: 111,
        }),
      ],
    },
  })
  const track = new MediaStreamTrack({ kind: "audio" })
  peer.addTrack(track)
  let received = 0,
    sent = 0,
    opusPayload = 111
  const ssrcs = new Set<number>()
  peer.onTrack.subscribe((remote) =>
    remote.onReceiveRtp.subscribe((packet) => {
      // DTMF is negotiated separately; count only the Opus speech stream.
      if (packet.header.payloadType !== opusPayload) return
      assert.ok(packet.payload.length > 0)
      received++
      ssrcs.add(packet.header.ssrc)
    })
  )
  let sending: NodeJS.Timeout | undefined
  try {
    if (direction === "inbound") {
      await peer.setLocalDescription(await peer.createOffer())
      assert.equal(peer.iceGatheringState, "complete")
      const offerSdp = metaSdp(peer.localDescription!.sdp, "offer")
      const { answerSdp } = await gateway.inbound(offerSdp, callId)
      opusPayload = Number(answerSdp.match(/a=rtpmap:(\d+) opus/i)![1])
      validateSdp(answerSdp, { side: "gateway", type: "answer" })
      const duplicate = await gateway.inbound(offerSdp, callId)
      assert.equal(duplicate.answerSdp, answerSdp)
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp })
    } else {
      const { offerSdp } = await gateway.outbound(callId)
      opusPayload = Number(offerSdp.match(/a=rtpmap:(\d+) opus/i)![1])
      validateSdp(offerSdp, { side: "gateway", type: "offer" })
      await peer.setRemoteDescription({ type: "offer", sdp: offerSdp })
      // Meta always acts as DTLS server, including when answering actpass.
      for (const dtls of peer.dtlsTransports) dtls.role = "server"
      const answer = await peer.createAnswer()
      await peer.setLocalDescription({
        type: "answer",
        sdp: answer.sdp.replace("a=setup:active", "a=setup:passive"),
      })
      assert.equal(peer.iceGatheringState, "complete")
      const answerSdp = metaSdp(peer.localDescription!.sdp, "answer")
      await gateway.remoteAnswer(callId, answerSdp)
      await gateway.remoteAnswer(callId, answerSdp)
    }
    await waitUntil(
      () => peer.connectionState === "connected",
      `${direction}: ICE/DTLS did not establish`
    )
    const info = await infoFor(callId)
    validateIceRuntime(info)
    const webrtc = info.webrtc as {
      ice: { ready: number }
      dtls: { "dtls-role": string; valid: boolean }
    }
    assert.equal(webrtc.ice.ready, 1, "Janus ICE gathering did not complete")
    assert.equal(webrtc.dtls["dtls-role"], "active")
    assert.equal(webrtc.dtls.valid, true)
    assert.ok(peer.iceTransports.every((ice) => ice.role === "controlled"))
    await delay(1000)
    assert.equal(
      received,
      0,
      "Audio escaped before Graph accept confirmation via /route"
    )
    const route = agent
      ? {
          callId,
          target: "agent" as const,
          extension: agent.extension,
          record: true,
        }
      : { callId, target: "ivr" as const, record: true }
    await gateway.route(route)
    await gateway.route(route)
    // Meta sends nothing yet: the business must send first to avoid deadlock.
    await waitUntil(
      () => received >= 10,
      `${direction}: gateway did not send first`
    )
    const senderSsrc = 12345678
    let sequence = 1000,
      timestamp = 48000
    sending = setInterval(() => {
      track.writeRtp(
        new RtpPacket(
          new RtpHeader({
            payloadType: opusPayload,
            ssrc: senderSsrc,
            sequenceNumber: sequence++ & 0xffff,
            timestamp: timestamp >>> 0,
          }),
          Buffer.from([0xf8, 0xff, 0xfe])
        )
      )
      timestamp += 960
      sent++
    }, 20)
    await waitUntil(
      () =>
        received >= 30 &&
        sent >= 20 &&
        callbacks.some(
          (event) => event.callId === callId && event.event === "media_up"
        ),
      `${direction}: bidirectional Opus or callback missing`
    )
    assert.equal(ssrcs.size, 1, "Business audio changed SSRC")
    if (agent) {
      let stats: BrowserAgentState | undefined
      await waitUntil(async () => {
        stats = await agent.stats()
        if (stats.error) throw new Error(stats.error)
        return (
          stats.answered &&
          stats.inboundPackets >= 20 &&
          stats.outboundPackets >= 20
        )
      }, "agent: answered bridge did not carry bidirectional browser RTP")
      // Exclude early ringback from the Meta-side media assertion.
      const before = received
      await waitUntil(
        () => received >= before + 30,
        "agent: no RTP after browser answer"
      )
      console.log(
        `PASS agent bridge: SIP.js answered, browser received ${stats!.inboundPackets} / sent ${stats!.outboundPackets} RTP packets; Meta received ${received} / sent ${sent}`
      )
    }
    await gateway.hangup(callId)
    await gateway.hangup(callId)
    await waitUntil(
      () =>
        callbacks.some(
          (event) => event.callId === callId && event.event === "hangup"
        ),
      "Missing hangup callback"
    )
    await waitUntil(
      () =>
        callbacks.some(
          (event) =>
            event.callId === callId && event.event === "recording_ready"
        ),
      "Missing finalized recording callback"
    )
    const recording = callbacks.find(
      (event) => event.callId === callId && event.event === "recording_ready"
    )!
    assert.equal(recording.event, "recording_ready")
    if (recording.event === "recording_ready")
      assert.ok(
        (await stat(recording.recordingFile)).size > 44,
        "Recording has no audio"
      )
    assert.ok(
      callbacks.some(
        (event) =>
          event.callId === callId &&
          event.event ===
            (direction === "inbound" ? "answer_ready" : "offer_ready")
      )
    )
    console.log(
      `PASS ${direction}: complete ICE, controlling Janus, DTLS client, gated/media-first audio, ${received} RTP packets, one SSRC, callbacks and recording`
    )
  } finally {
    clearInterval(sending)
    await gateway.hangup(callId).catch(() => undefined)
    await peer.close()
  }
}
try {
  if (process.argv.includes("agent")) {
    const agent = await browserAgent()
    try {
      await run("inbound", agent)
    } finally {
      await agent.close()
    }
  } else {
    await run("inbound")
    await run("outbound")
  }
} finally {
  clearTimeout(watchdog)
  await new Promise<void>((resolve) => receiver.close(() => resolve()))
}
