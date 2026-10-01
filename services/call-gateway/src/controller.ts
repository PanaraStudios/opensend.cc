import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { Config } from "./config.js"
import type { CallbackPayload, GatewayApi, RouteRequest } from "./contracts.js"
import { ConvexCallbacks } from "./callbacks.js"
import { FreeSwitch } from "./esl.js"
import { GatewayError } from "./errors.js"
import { JanusSession, type JanusEvent } from "./janus.js"
import { gatewaySdp, metaSdp, validateIceRuntime } from "./sdp.js"

interface Call {
  id: string
  extension: string
  janus: JanusSession
  direction: "inbound" | "outbound"
  uuid?: string
  localSdp?: string
  remoteSdp?: string
  routed?: RouteRequest
  answered: boolean
  mediaReported: boolean
  ending: boolean
  created: number
  setup: Promise<{ answerSdp: string } | { offerSdp: string }>
}

export function validateRoute(request: RouteRequest): void {
  if (!["agent", "ivr", "queue", "bot"].includes(request.target))
    throw new GatewayError("INVALID_ROUTE", "Unknown route target")
  if (request.target === "queue" || request.target === "bot")
    throw new GatewayError(
      "ROUTE_NOT_IMPLEMENTED",
      "Queue and bot routing belong to task 8d",
      501
    )
  if (request.target === "agent" && !/^20\d{2}$/.test(request.extension ?? ""))
    throw new GatewayError(
      "INVALID_EXTENSION",
      "Agent extension must be 2000–2099"
    )
  if (request.record !== undefined && typeof request.record !== "boolean")
    throw new GatewayError("INVALID_RECORD", "record must be boolean")
}

export class CallController implements GatewayApi {
  private readonly calls = new Map<string, Call>()
  private readonly ended = new Map<string, number>()
  private readonly recordings = new Map<
    string,
    { call: Call; expires: number }
  >()
  private readonly fs: FreeSwitch
  private readonly callbacks: ConvexCallbacks
  private sweep?: NodeJS.Timeout
  private reconnecting = false
  private readonly session: () => JanusSession
  constructor(
    private readonly options: Config,
    dependencies: {
      fs?: FreeSwitch
      callbacks?: ConvexCallbacks
      session?: () => JanusSession
    } = {}
  ) {
    this.fs =
      dependencies.fs ??
      new FreeSwitch(options.fsHost, options.fsPort, options.fsSecret)
    this.callbacks =
      dependencies.callbacks ??
      new ConvexCallbacks(options.convexUrl, options.secret)
    this.session =
      dependencies.session ??
      (() =>
        new JanusSession(
          options.janusUrl,
          options.janusAdminUrl,
          options.janusSecret
        ))
    this.fs.on("event", (event) => this.fsEvent(event))
    this.fs.on("failure", () => {
      for (const call of this.calls.values())
        void this.finish(call, "FreeSWITCH disconnected")
    })
  }
  async start() {
    await this.fs.open()
    this.sweep = setInterval(() => {
      if (!this.fs.ready && !this.reconnecting) {
        this.reconnecting = true
        void this.fs
          .open()
          .catch(() => undefined)
          .finally(() => {
            this.reconnecting = false
          })
      }
      for (const [id, expiry] of this.ended)
        if (expiry < Date.now()) this.ended.delete(id)
      for (const [uuid, entry] of this.recordings)
        if (entry.expires < Date.now()) this.recordings.delete(uuid)
      // Bound orphaned setup/pre-accepted calls; established calls have no duration cap.
      for (const call of this.calls.values())
        if (!call.routed && Date.now() - call.created > 60000)
          void this.finish(call, "Call was not routed within 60 seconds")
    }, 5000)
  }
  private notify(call: Call, payload: CallbackPayload) {
    void this.callbacks
      .emit(call.id, payload)
      .catch((error) => console.error(String(error)))
  }
  private get(callId: string): Call {
    const call = this.calls.get(callId)
    if (!call || call.ending)
      throw new GatewayError("CALL_NOT_FOUND", "Call does not exist", 404)
    return call
  }
  private allocate(
    callId: string,
    direction: Call["direction"],
    remoteSdp?: string
  ): Call {
    if (this.ended.has(callId))
      throw new GatewayError("CALL_ENDED", "Call already ended", 409)
    if (!this.fs.ready)
      throw new GatewayError(
        "ESL_UNAVAILABLE",
        "FreeSWITCH is unavailable",
        503
      )
    const used = new Set([...this.calls.values()].map((call) => call.extension))
    const extension = Array.from({ length: 100 }, (_, i) =>
      String(1000 + i)
    ).find((id) => !used.has(id))
    if (!extension)
      throw new GatewayError(
        "CALL_CAPACITY",
        "All 100 media slots are busy",
        503
      )
    const janus = this.session()
    const call: Call = {
      id: callId,
      extension,
      direction,
      janus,
      remoteSdp,
      answered: direction === "inbound",
      mediaReported: false,
      ending: false,
      created: Date.now(),
      setup: Promise.resolve({ offerSdp: "" }),
    }
    this.calls.set(callId, call)
    janus.on("event", (event: JanusEvent) => {
      const result = event.plugindata?.data.result
      if (
        event.janus === "media" &&
        event.type === "audio" &&
        event.receiving &&
        !call.mediaReported
      ) {
        call.mediaReported = true
        this.notify(call, { event: "media_up" })
      }
      if (
        event.janus === "hangup" ||
        result?.event === "hangup" ||
        result?.event === "updatingcall"
      )
        void this.finish(
          call,
          result?.reason ?? "Janus call ended or renegotiation requested"
        )
    })
    janus.on("failure", () => {
      if (!call.ending) void this.finish(call, "Janus connection lost")
    })
    return call
  }
  private async register(call: Call) {
    await call.janus.open(call.id)
    await Promise.all([
      call.janus.waitFor(
        (event) => event.plugindata?.data.result?.event === "registered"
      ),
      call.janus.message({
        request: "register",
        username: `sip:${call.extension}@${this.options.fsHost}`,
        secret: this.options.sipSecret,
        proxy: `sip:${this.options.fsHost}:5060`,
        force_udp: true,
        register_ttl: 120,
      }),
    ])
  }
  async inbound(
    offerSdp: string,
    callId: string
  ): Promise<{ answerSdp: string }> {
    const remote = metaSdp(offerSdp, "offer")
    const existing = this.calls.get(callId)
    if (existing) {
      if (existing.direction !== "inbound" || existing.remoteSdp !== remote)
        throw new GatewayError(
          "CALL_CONFLICT",
          "Call id already used with different SDP",
          409
        )
      return (await existing.setup) as { answerSdp: string }
    }
    const call = this.allocate(callId, "inbound", remote)
    call.setup = this.prepareInbound(call)
    return (await call.setup) as { answerSdp: string }
  }
  private async prepareInbound(call: Call) {
    try {
      await this.register(call)
      const [event] = await Promise.all([
        call.janus.waitFor((event) => event.jsep?.type === "answer"),
        call.janus.message(
          {
            request: "call",
            uri: `sip:c2b-sip@${this.options.fsHost}:5060`,
            headers: { "X-OpenSend-Call-Id": call.id },
            srtp: "sdes_mandatory",
          },
          { type: "offer", sdp: call.remoteSdp! }
        ),
      ])
      call.localSdp = gatewaySdp(event.jsep!.sdp, "answer")
      validateIceRuntime(await call.janus.info())
      await this.parked(call)
      this.notify(call, { event: "answer_ready", answerSdp: call.localSdp })
      return { answerSdp: call.localSdp }
    } catch (error) {
      await this.finish(call, "Inbound setup failed")
      throw error
    }
  }
  async outbound(callId: string): Promise<{ offerSdp: string }> {
    const existing = this.calls.get(callId)
    if (existing) {
      if (existing.direction !== "outbound")
        throw new GatewayError("CALL_CONFLICT", "Call direction differs", 409)
      return (await existing.setup) as { offerSdp: string }
    }
    const call = this.allocate(callId, "outbound")
    call.uuid = randomUUID()
    call.setup = this.prepareOutbound(call)
    return (await call.setup) as { offerSdp: string }
  }
  private async prepareOutbound(call: Call) {
    try {
      await this.register(call)
      const [event] = await Promise.all([
        call.janus.waitFor(
          (event) =>
            event.plugindata?.data.result?.event === "incomingcall" &&
            event.jsep?.type === "offer"
        ),
        this.fs.bgapi(
          `originate {origination_uuid=${call.uuid},opensend_call_id=${call.id},absolute_codec_string=OPUS@48000h@20i,rtp_secure_media=mandatory,originate_timeout=45}user/${call.extension}@${this.options.fsHost} &park()`
        ),
      ])
      call.localSdp = gatewaySdp(event.jsep!.sdp, "offer")
      validateIceRuntime(await call.janus.info())
      this.notify(call, { event: "offer_ready", offerSdp: call.localSdp })
      return { offerSdp: call.localSdp }
    } catch (error) {
      await this.finish(call, "Outbound setup failed")
      throw error
    }
  }
  async remoteAnswer(callId: string, sdp: string) {
    const call = this.get(callId)
    if (call.direction !== "outbound")
      throw new GatewayError(
        "CALL_DIRECTION",
        "remoteAnswer requires an outbound call",
        409
      )
    await call.setup
    const answer = metaSdp(sdp, "answer")
    if (call.remoteSdp && call.remoteSdp !== answer)
      throw new GatewayError(
        "RENEGOTIATION_UNSUPPORTED",
        "Remote answer cannot change",
        409
      )
    if (call.answered) return
    call.remoteSdp = answer
    try {
      await Promise.all([
        call.janus.waitFor(
          (event) => event.plugindata?.data.result?.event === "accepted"
        ),
        call.janus.message(
          { request: "accept", srtp: "sdes_mandatory" },
          { type: "answer", sdp: answer }
        ),
      ])
      await this.parked(call)
      call.answered = true
    } catch (error) {
      await this.finish(call, "Remote answer failed")
      throw error
    }
  }
  private async parked(call: Call) {
    for (let i = 0; i < 100; i++) {
      if (call.ending)
        throw new GatewayError("CALL_ENDED", "Call ended during setup", 409)
      if (
        call.uuid &&
        (await this.fs.api(`uuid_getvar ${call.uuid} current_application`)) ===
          "park"
      )
        return
      await delay(50)
    }
    throw new GatewayError(
      "GATEWAY_TIMEOUT",
      "FreeSWITCH leg did not park",
      504
    )
  }
  async route(request: RouteRequest) {
    validateRoute(request)
    const call = this.get(request.callId)
    await call.setup
    if (!call.answered)
      throw new GatewayError(
        "ANSWER_REQUIRED",
        "Apply remoteAnswer before routing outbound calls",
        409
      )
    if (call.routed) {
      if (JSON.stringify(call.routed) === JSON.stringify(request)) return
      throw new GatewayError(
        "ROUTE_CONFLICT",
        "Call already routed; transfer controls belong to task 8c",
        409
      )
    }
    await this.parked(call)
    if (request.target === "agent")
      await this.fs.api(
        `uuid_setvar ${call.uuid} opensend_agent ${request.extension}`
      )
    if (request.record) {
      await this.fs.api(`uuid_setvar ${call.uuid} opensend_record true`)
      this.recordings.set(call.uuid!, { call, expires: Infinity })
    }
    // The authenticated route invocation is Convex's confirmation that Graph accept returned 200.
    await Promise.all([
      call.janus.waitFor(
        (event) => event.plugindata?.data.result?.event === "media_gate"
      ),
      call.janus.message({ request: "opensend_media", enabled: true }),
    ])
    try {
      await this.fs.api(
        `uuid_transfer ${call.uuid} ${request.target === "agent" ? "agent-route" : "ivr-demo"} XML calling`
      )
      call.routed = request
    } catch (error) {
      await this.finish(call, "Routing failed")
      throw error
    }
  }
  async hangup(callId: string) {
    const call = this.calls.get(callId)
    if (!call) {
      this.ended.set(callId, Date.now() + 300000)
      return
    }
    await this.finish(call, "Controller hangup")
  }
  private async finish(call: Call, reason: string) {
    if (call.ending) return
    call.ending = true
    const recording = call.uuid && this.recordings.get(call.uuid)
    if (recording) recording.expires = Date.now() + 60000
    this.ended.set(call.id, Date.now() + 300000)
    this.notify(call, { event: "hangup", reason })
    if (call.uuid && this.fs.ready)
      await this.fs
        .api(`uuid_kill ${call.uuid} NORMAL_CLEARING`)
        .catch(() => undefined)
    await call.janus.close()
    this.calls.delete(call.id)
  }
  private fsEvent(event: Record<string, string>) {
    const id =
      event.variable_opensend_call_id ??
      event["variable_sip_h_X-OpenSend-Call-Id"]
    const call =
      this.calls.get(id) ??
      [...this.calls.values()].find(
        (call) => call.uuid === event["Unique-ID"]
      ) ??
      this.recordings.get(event["Unique-ID"])?.call
    if (!call) return
    if (event["Event-Name"] === "CHANNEL_PARK") call.uuid = event["Unique-ID"]
    if (
      event["Event-Name"] === "RECORD_STOP" &&
      event["Record-File-Path"] === `/recordings/${call.uuid}.wav` &&
      this.recordings.has(call.uuid!)
    ) {
      this.notify(call, {
        event: "recording_ready",
        recordingFile: event["Record-File-Path"],
      })
      this.recordings.delete(call.uuid!)
    }
    if (event["Event-Name"] === "CHANNEL_HANGUP_COMPLETE")
      void this.finish(call, event["Hangup-Cause"] ?? "SIP hangup")
  }
  async healthy() {
    if (!this.fs.ready) return false
    try {
      const response = await fetch(`${this.options.janusUrl}/info`, {
        signal: AbortSignal.timeout(2000),
      })
      const info = (await response.json()) as Record<string, unknown>
      return (
        response.ok &&
        info["ice-lite"] === false &&
        info["full-trickle"] === false
      )
    } catch {
      return false
    }
  }
  async close() {
    clearInterval(this.sweep)
    await Promise.all(
      [...this.calls.values()].map((call) =>
        this.finish(call, "Gateway shutdown")
      )
    )
    this.fs.close()
  }
}
