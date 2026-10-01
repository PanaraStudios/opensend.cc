import { validateBot, toolDeclarations } from "../src/voice/catalog.js"
/** Docker-only harness; fake Meta/backend plus an optional real SIP.js browser. */
import { opusTone, decodeOpus, tonePower } from "./opus-audio.js"
import type { VoiceEvent, VoiceToolRequest } from "../src/voice-backend.js"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createHmac, randomUUID } from "node:crypto"
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

const returnFlow = process.argv.includes("bot-ivr")
const combinedFlow = process.argv.includes("ivr-bot-agent")
const pipecatEngine =
  process.argv.includes("bot-engine") || combinedFlow || returnFlow
const secret = process.env.CALL_GATEWAY_SECRET ?? ""
const verifier = new HmacVerifier(secret)
const gateway = new CallGatewayClient(
  process.env.CALL_GATEWAY_URL ?? "http://call-gateway:8090",
  secret
)
const janusAdmin = process.env.JANUS_ADMIN_URL ?? "http://janus:7088/admin"
const callbacks: GatewayCallback[] = []
const voiceEvents: (VoiceEvent & {
  version: 1
  callId: string
  eventId: string
  timestamp: number
})[] = []
const toolRequests: VoiceToolRequest[] = []
let harnessAgentExtension: string | undefined
const ivrPaths: {
  callId: string
  menuId: string
  digits: string
  action: { kind: string; menuId?: string; botId?: string }
  at: number
}[] = []
const ivrStarts: string[] = []
let ivrAudioFetches = 0
function fixturePrompt() {
  const expires = Date.now() + 600_000
  const signature = createHmac("sha256", secret)
    .update(String(expires))
    .digest("hex")
  return `http://meta-peer:8091/test/ivr/prompt.wav?expires=${expires}&signature=${signature}`
}
function fixtureMenu(id: string, step: number) {
  return {
    step,
    organizationId: "harness-team",
    action: { kind: "submenu", menuId: id },
    menu: {
      id,
      promptUrl: fixturePrompt(),
      timeoutSeconds: 5,
      retries: 2,
      maxDigits: 1,
      digits: [id === "main" ? "1" : "2"],
    },
  }
}
function promptWav() {
  const samples = 16000,
    wav = Buffer.alloc(44 + samples * 2)
  wav.write("RIFF")
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write("WAVEfmt ", 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
      44 + i * 2
    )
  return wav
}
const receiver = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/test/ivr/prompt.wav")) {
      const q = new URL(request.url, "http://meta-peer:8091").searchParams
      const expires = Number(q.get("expires"))
      assert.ok(expires > Date.now())
      assert.equal(
        q.get("signature"),
        createHmac("sha256", secret).update(String(expires)).digest("hex")
      )
      ivrAudioFetches++
      response.writeHead(200, { "content-type": "audio/wav" }).end(promptWav())
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    if (
      request.url === "/calling/gateway/ivr/start" ||
      request.url === "/calling/gateway/ivr/next"
    ) {
      verifier.verify(request.method!, request.url, body, request.headers)
      const input = JSON.parse(body)
      assert.equal(input.ivrId, "harness-ivr")
      if (request.url.endsWith("start")) {
        ivrStarts.push(input.callId)
        response.writeHead(200).end(JSON.stringify(fixtureMenu("main", 0)))
      } else {
        const path = ivrPaths.filter((p) => p.callId === input.callId)
        assert.equal(input.step, path.length)
        assert.equal(input.menuId, path.length ? "support" : "main")
        assert.equal(input.digits, path.length ? "2" : "1")
        const action = returnFlow
          ? { kind: "agents" }
          : combinedFlow
            ? { kind: "bot", botId: "harness-bot" }
            : path.length
              ? { kind: "voicemail" }
              : { kind: "submenu", menuId: "support" }
        ivrPaths.push({
          callId: input.callId,
          menuId: input.menuId,
          digits: input.digits,
          action,
          at: Date.now(),
        })
        const decision =
          action.kind === "submenu"
            ? fixtureMenu("support", 1)
            : {
                step: path.length + 1,
                organizationId: "harness-team",
                action,
                ...(action.kind === "agents"
                  ? { extension: harnessAgentExtension! }
                  : {}),
                ...(action.kind === "bot"
                  ? {
                      route: {
                        callId: input.callId,
                        target: "bot",
                        botId: "harness-bot",
                        organizationId: "harness-team",
                        codec: "L16",
                        maxDurationSeconds: 30,
                        record: true,
                      },
                    }
                  : {}),
              }
        response.writeHead(200).end(JSON.stringify(decision))
      }
      return
    }
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
    if (request.url === "/calling/gateway/voice/events") {
      verifier.verify(request.method!, request.url, body, request.headers)
      const event = JSON.parse(body) as (typeof voiceEvents)[number]
      assert.equal(event.version, 1)
      voiceEvents.push(event)
      response.writeHead(200).end('{"ok":true}')
      return
    }
    if (request.url === "/calling/gateway/voice/session") {
      verifier.verify(request.method!, request.url, body, request.headers)
      const session = JSON.parse(body)
      assert.equal(session.organizationId, "harness-team")
      assert.ok(session.callId.startsWith("harness-inbound-"))
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(
          JSON.stringify({
            ...validateBot({
              name: "Harness Pipecat",
              provider: "gemini",
              engine: "gemini_live",
              credentialId: "harness-credential",
              tools: returnFlow
                ? ["lookup_contact", "transfer_to_ivr"]
                : combinedFlow
                  ? ["lookup_contact", "transfer_to_agent"]
                  : ["lookup_contact"],
              handoff: {
                agents: true,
                ...(returnFlow ? { ivrId: "harness-ivr" } : {}),
              },
              maxDurationSeconds: returnFlow ? 30 : 6,
            }),
            botId: "harness-bot",
            keys: { live: "fake-key" },
            toolCatalog: toolDeclarations(
              returnFlow
                ? ["lookup_contact", "transfer_to_ivr"]
                : combinedFlow
                  ? ["lookup_contact", "transfer_to_agent"]
                  : ["lookup_contact"]
            ),
          })
        )
      return
    }
    if (request.url === "/calling/gateway/voice/tools") {
      verifier.verify(request.method!, request.url, body, request.headers)
      const tool = JSON.parse(body) as VoiceToolRequest
      assert.equal(tool.version, 1)
      assert.equal(tool.organizationId, "harness-team")
      assert.ok(tool.callId.startsWith("harness-inbound-"))
      assert.ok(
        tool.toolCall.name === "lookup_contact" ||
          (combinedFlow && tool.toolCall.name === "transfer_to_agent") ||
          (returnFlow && tool.toolCall.name === "transfer_to_ivr")
      )
      if (tool.toolCall.name === "lookup_contact")
        assert.deepEqual(tool.toolCall.arguments, {})
      toolRequests.push(tool)
      response.writeHead(200).end(
        JSON.stringify({
          ok: true,
          result:
            tool.toolCall.name === "transfer_to_ivr"
              ? { action: "transfer_to_ivr", ivrId: "harness-ivr" }
              : tool.toolCall.name === "transfer_to_agent"
                ? {
                    action: "transfer_to_agent",
                    extension: harnessAgentExtension!,
                  }
                : { contactId: "fixture-contact" },
        })
      )
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
  harnessAgentExtension = credential.extension
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
      `PASS agent registration: extension ${credential.extension}, backend-issued ephemeral credential, XML-CURL directory, SIP.js over WSS`
    )
    const currentPage = page
    return {
      extension: credential.extension,
      dtmf: (digit: string) =>
        currentPage.evaluate((d) => window.agent.dtmf(d), digit),
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
  agent?: Awaited<ReturnType<typeof browserAgent>>,
  voice?: "L16" | "PCMU" | "ivr" | "ivr-engine" | "ivr-bot-agent" | "bot-ivr"
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
        new RTCRtpCodecParameters({
          mimeType: "audio/telephone-event",
          clockRate: 8000,
          payloadType: 101,
        }),
      ],
    },
  })
  const track = new MediaStreamTrack({ kind: "audio" })
  const sender = peer.addTrack(track)
  let received = 0,
    sent = 0,
    opusPayload = 111
  const ssrcs = new Set<number>()
  const captured: { payload: Buffer; time: number }[] = []
  peer.onTrack.subscribe((remote) =>
    remote.onReceiveRtp.subscribe((packet) => {
      // DTMF is negotiated separately; count only the Opus speech stream.
      if (packet.header.payloadType !== opusPayload) return
      assert.ok(packet.payload.length > 0)
      received++
      captured.push({ payload: Buffer.from(packet.payload), time: Date.now() })
      ssrcs.add(packet.header.ssrc)
    })
  )
  let sending: NodeJS.Timeout | undefined
  let lastSentHeader: RtpHeader | undefined
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
    const route =
      voice &&
      voice !== "ivr" &&
      voice !== "ivr-engine" &&
      voice !== "ivr-bot-agent"
        ? {
            callId,
            target: "bot" as const,
            ...(pipecatEngine
              ? { botId: "harness-bot" }
              : { adapter: "fake-echo" as const }),
            organizationId: "harness-team",
            codec: voice === "PCMU" ? ("PCMU" as const) : ("L16" as const),
            maxDurationSeconds: returnFlow ? 30 : 6,
            record: true,
          }
        : agent && !combinedFlow && !returnFlow
          ? {
              callId,
              target: "agent" as const,
              extension: agent.extension,
              record: true,
            }
          : {
              callId,
              target: "ivr" as const,
              record: true,
              ...(["ivr-engine", "ivr-bot-agent"].includes(voice ?? "")
                ? { ivrId: "harness-ivr" }
                : {}),
            }
    const routeAt = Date.now()
    await gateway.route(route)
    await gateway.route(route)
    // Meta sends nothing yet: the business must send first to avoid deadlock.
    await waitUntil(() => {
      const ended = callbacks.find(
        (event) => event.callId === callId && event.event === "hangup"
      )
      if (ended?.event === "hangup")
        throw new Error(`Call ended before first audio: ${ended.reason}`)
      return received >= 10
    }, `${direction}: gateway did not send first`)
    const senderSsrc = 12345678
    let sequence = 1000,
      timestamp = 48000
    const tonePackets =
      voice && voice !== "ivr" && voice !== "ivr-engine"
        ? await opusTone(440)
        : []
    const startSending = () =>
      setInterval(() => {
        const packet = new RtpPacket(
          new RtpHeader({
            payloadType: opusPayload,
            ssrc: senderSsrc,
            sequenceNumber: sequence++ & 0xffff,
            timestamp: timestamp >>> 0,
          }),
          tonePackets.length
            ? tonePackets[sent % tonePackets.length]
            : Buffer.from([0xf8, 0xff, 0xfe])
        )
        track.writeRtp(packet)
        // Werift rewrites this header before sending; retain it for RFC2833 clocks.
        lastSentHeader = packet.header
        timestamp += 960
        sent++
      }, 20)
    sending = startSending()
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
    if (agent && !combinedFlow && !returnFlow) {
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
    if (
      voice === "ivr" ||
      voice === "ivr-engine" ||
      voice === "ivr-bot-agent" ||
      voice === "bot-ivr"
    ) {
      if (returnFlow)
        await waitUntil(
          () =>
            voiceEvents.some(
              (e) =>
                e.callId === callId && e.type === "state" && e.state === "ivr"
            ),
          "Bot did not enter IVR on the anchored channel"
        )
      clearInterval(sending)
      const info = await infoFor(callId)
      const negotiated = peer.remoteDescription!.sdp.match(
        /a=rtpmap:(\d+) telephone-event\/8000/i
      )
      assert.ok(negotiated, "IVR did not negotiate DTMF")
      const pt = Number(negotiated[1])
      // Capture Werift's offset once: direct DTMF sends do not update its speech header.
      const sequenceOffset =
        (lastSentHeader?.sequenceNumber ?? sequence - 1) - (sequence - 1)
      const sendDigit = async (digit: number, offset: number) => {
        const eventTimestamp =
          Math.floor((lastSentHeader?.timestamp ?? timestamp) / 6) +
          offset * 160
        for (let i = 0; i < 10; i++) {
          const payload = Buffer.from([digit, i >= 7 ? 0x8a : 0x0a, 0, 0])
          payload.writeUInt16BE(Math.min(i + 1, 7) * 160, 2)
          await sender.dtlsTransport.sendRtp(
            payload,
            new RtpHeader({
              payloadType: pt,
              ssrc: sender.ssrc,
              sequenceNumber: (sequence++ + sequenceOffset) & 65535,
              timestamp: eventTimestamp,
              marker: i === 0,
            })
          )
          await delay(20)
        }
      }
      if (returnFlow) {
        await waitUntil(
          () => ivrStarts.includes(callId) && ivrAudioFetches > 0,
          "Returned IVR did not fetch its prompt"
        )
        await delay(1000)
      }
      await sendDigit(1, 0)
      if (returnFlow) {
        sending = startSending()
        await waitUntil(
          () =>
            ivrPaths.some(
              (p) => p.callId === callId && p.action.kind === "agents"
            ),
          "Returned IVR did not receive digit 1"
        )
        await waitUntil(async () => {
          const stats = await agent!.stats()
          if (stats.error) throw new Error(stats.error)
          return (
            stats.answered &&
            stats.inboundPackets >= 20 &&
            stats.outboundPackets >= 20
          )
        }, "Bot → IVR → agent did not carry browser audio")
        assert.ok(
          voiceEvents.some(
            (e) =>
              e.callId === callId &&
              e.type === "bot_completed" &&
              e.outcome === "transferred_ivr"
          )
        )
        assert.deepEqual(
          ivrPaths
            .filter((p) => p.callId === callId)
            .map((p) => [p.menuId, p.digits, p.action.kind]),
          [["main", "1", "agents"]]
        )
        assert.ok(
          !callbacks.some((e) => e.callId === callId && e.event === "hangup")
        )
        console.log(
          "PASS bot return: Pipecat transfer_to_ivr → same-channel IVR RFC2833 digit 1 → SIP.js agent audio"
        )
      }
      if (voice === "ivr-bot-agent") {
        await waitUntil(
          () =>
            ivrPaths.some(
              (p) => p.callId === callId && p.action.kind === "bot"
            ),
          "IVR bot decision missing"
        )
        sending = startSending()
        await waitUntil(
          () =>
            toolRequests.some(
              (t) =>
                t.callId === callId && t.toolCall.name === "transfer_to_agent"
            ),
          "Bot transfer tool missing"
        )
        try {
          await waitUntil(async () => {
            const stats = await agent!.stats()
            if (stats.error) throw new Error(stats.error)
            if (
              callbacks.some((e) => e.callId === callId && e.event === "hangup")
            )
              throw new Error("Call ended during bot transfer")
            return (
              stats.answered &&
              stats.inboundPackets >= 20 &&
              stats.outboundPackets >= 20
            )
          }, "IVR → bot → agent did not bridge browser audio")
        } catch (error) {
          console.error(
            "Combined flow diagnostics",
            JSON.stringify({
              agent: await agent!.stats(),
              callbacks: callbacks
                .filter((e) => e.callId === callId)
                .map((e) => ({
                  event: e.event,
                  ...("reason" in e ? { reason: e.reason } : {}),
                })),
              state: voiceEvents.filter(
                (e) => e.callId === callId && e.type === "state"
              ),
              tools: toolRequests
                .filter((t) => t.callId === callId)
                .map((t) => t.toolCall.name),
            })
          )
          throw error
        }
        await waitUntil(
          () =>
            voiceEvents.some(
              (e) =>
                e.callId === callId &&
                e.type === "bot_completed" &&
                e.outcome === "transferred_agent"
            ),
          "Bot transfer outcome missing"
        )
        assert.deepEqual(
          ivrPaths
            .filter((p) => p.callId === callId)
            .map((p) => [p.menuId, p.digits, p.action.kind]),
          [["main", "1", "bot"]]
        )
        assert.equal(
          voiceEvents.filter(
            (e) => e.callId === callId && e.type === "bot_completed"
          ).length,
          1
        )
        assert.ok(
          !callbacks.some((e) => e.callId === callId && e.event === "hangup"),
          "Transfer hung up the anchored call"
        )
        console.log(
          "PASS combined: call → IVR RFC2833 digit 1 → Pipecat bot → transfer_to_agent → SIP.js bidirectional audio; one call, path and transfer outcome"
        )
      }
      if (voice === "ivr-engine") {
        await waitUntil(
          () =>
            ivrPaths.some(
              (p) => p.callId === callId && p.action.kind === "submenu"
            ),
          "IVR main menu decision was not recorded"
        )
        await delay(1000)
        await sendDigit(2, 100)
        await waitUntil(
          () => ivrPaths.filter((p) => p.callId === callId).length === 2,
          "IVR submenu decision was not recorded"
        )
        await waitUntil(
          () =>
            voiceEvents.some(
              (e) =>
                e.callId === callId &&
                e.type === "state" &&
                e.state === "voicemail"
            ),
          "IVR did not enter voicemail"
        )
        assert.deepEqual(
          ivrPaths
            .filter((p) => p.callId === callId)
            .map((p) => [p.menuId, p.digits, p.action.kind]),
          [
            ["main", "1", "submenu"],
            ["support", "2", "voicemail"],
          ]
        )
        assert.ok(
          ivrAudioFetches >= 2,
          "http_cache/prefetch did not fetch signed prompt audio"
        )
        console.log(
          "PASS IVR engine: signed http_cache prompts; RFC2833 main 1 → support 2 → voicemail; two path entries recorded by fake backend"
        )
      }
      assert.ok(info.webrtc)
      if (voice === "ivr") {
        await waitUntil(
          () =>
            voiceEvents.some(
              (event) =>
                event.callId === callId &&
                event.type === "ivr_digits" &&
                event.digits === "1"
            ),
          "ESL play_and_get_digits did not receive RFC2833 digit 1"
        )
        console.log(
          "PASS IVR: RFC2833 digit 1 through Meta/Janus, async/full ESL play_and_get_digits completed"
        )
      }
    } else if (voice) {
      await waitUntil(
        () =>
          voiceEvents.some(
            (event) => event.callId === callId && event.type === "barge_in"
          ),
        "Fake bot did not interrupt"
      )
      const barge = voiceEvents.find(
        (event) => event.callId === callId && event.type === "barge_in"
      )!
      assert.equal(barge.type, "barge_in")
      if (barge.type === "barge_in") {
        assert.ok(barge.flushedMs >= (pipecatEngine ? 0 : 1001))
        assert.ok(barge.playedMs > 0 && barge.playedMs < 2000)
      }
      await waitUntil(
        () =>
          voiceEvents.some(
            (event) =>
              event.callId === callId &&
              event.type === "transcript" &&
              event.transcript.text.includes("fixture-contact")
          ),
        "Tool result did not reach adapter"
      )
      assert.equal(
        toolRequests.filter((tool) => tool.callId === callId).length,
        1
      )
      await delay(1200)
      const after = captured
        .filter((packet) => packet.time > barge.timestamp + 300)
        .map((packet) => packet.payload)
      assert.ok(after.length >= 20)
      const pcm = await decodeOpus(after)
      const echoPower = tonePower(pcm, 440),
        stalePower = tonePower(pcm, 880)
      assert.ok(echoPower > 100, `Echo tone missing: ${echoPower}`)
      assert.ok(
        echoPower > stalePower * 8,
        `Greeting survived barge-in: echo=${echoPower}, stale=${stalePower}`
      )
      await waitUntil(
        () =>
          callbacks.some(
            (event) => event.callId === callId && event.event === "hangup"
          ),
        "FreeSWITCH sched_hangup did not enforce cap",
        8000
      )
      const ended = callbacks.find(
        (event) => event.callId === callId && event.event === "hangup"
      )!
      assert.ok(Date.now() - routeAt < 8500)
      assert.equal(ended.event, "hangup")
      if (ended.event === "hangup")
        assert.equal(ended.reason, "ALLOTTED_TIMEOUT")
      await waitUntil(
        () =>
          voiceEvents.some(
            (event) => event.callId === callId && event.type === "media"
          ),
        "Missing media timing report"
      )
      const report = voiceEvents.find(
        (event) => event.callId === callId && event.type === "media"
      )!
      if (report.type === "media") {
        assert.equal(report.codec, voice)
        assert.ok(report.received >= 20 && report.sent >= 20)
        assert.ok(
          report.received > report.sent * 0.7,
          "Jitter buffer discarded most incoming audio"
        )
        assert.ok(
          report.late < 10,
          "Remote clock drift caused persistent late-packet loss"
        )
        console.log(
          `PASS Path B ${voice}: decoded 440Hz echo=${echoPower.toFixed(0)}, stale 880Hz=${stalePower.toFixed(0)}; RTP received ${report.received} / sent ${report.sent}; jitter lost ${report.lost}, late ${report.late}; max tick delay ${report.maxTickDelayMs}ms`
        )
      }
      if (barge.type === "barge_in")
        console.log(
          `PASS barge-in ${voice}: played ${barge.playedMs}ms, flushed ${barge.flushedMs}ms; tool HMAC request/result delivered once; sched_hangup ALLOTTED_TIMEOUT at ${ended.timestamp - routeAt}ms`
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
  if (process.argv.includes("playground")) {
    const agent = await browserAgent(),
      callId = `playground-${randomUUID()}`
    try {
      await gateway.playground({ callId, extension: agent.extension })
      await gateway.route({
        callId,
        target: "ivr",
        ivrId: "harness-ivr",
        organizationId: "harness-team",
      })
      await waitUntil(
        async () => (await agent.stats()).inboundPackets > 10,
        "Browser did not receive IVR prompt"
      )
      await delay(1500)
      await agent.dtmf("1")
      await waitUntil(
        () => ivrPaths.some((p) => p.callId === callId && p.digits === "1"),
        "Browser RFC2833 main digit missing"
      )
      await delay(1500)
      await agent.dtmf("2")
      await waitUntil(
        () => ivrPaths.filter((p) => p.callId === callId).length === 2,
        "Browser submenu digit missing"
      )
      assert.ok(ivrAudioFetches >= 2)
      await gateway.hangup(callId)
      await waitUntil(
        () =>
          callbacks.some((e) => e.callId === callId && e.event === "hangup"),
        "Browser hangup callback missing"
      )
      console.log(
        "PASS playground: ephemeral SIP.js caller → FreeSWITCH → real IVR runner, HTTP-cache WAV, RFC2833 1 → 2 → voicemail, signed path decisions and hangup"
      )
    } finally {
      await gateway.hangup(callId).catch(() => undefined)
      await agent.close()
    }
  } else if (returnFlow || combinedFlow) {
    const agent = await browserAgent()
    try {
      await run("inbound", agent, returnFlow ? "bot-ivr" : "ivr-bot-agent")
    } finally {
      await agent.close()
    }
  } else if (process.argv.includes("ivr-engine")) {
    await run("inbound", undefined, "ivr-engine")
  } else if (process.argv.includes("ivr")) {
    await run("inbound", undefined, "ivr")
  } else if (pipecatEngine) {
    await run("inbound", undefined, "L16")
    await run("inbound", undefined, "PCMU")
    assert.ok(
      voiceEvents.some(
        (event) =>
          event.type === "bot_completed" &&
          event.summary.includes("Harness caller")
      )
    )
    console.log(
      "PASS Pipecat: signed session fetch, Python pipeline, transcript, tool, clear and completion summary"
    )
  } else if (process.argv.includes("voice")) {
    await run("inbound", undefined, "L16")
    await run("inbound", undefined, "PCMU")
    await run("inbound", undefined, "ivr")
  } else if (process.argv.includes("agent")) {
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
