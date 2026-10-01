import { CallStateMachine } from "./call-state.js"
import type { VoiceRuntime } from "./voice-runtime.js"
import { agentQueues } from "./queues.js"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { Config } from "./config.js"
import type {
  AgentControl,
  CallbackPayload,
  GatewayApi,
  RouteRequest,
} from "./contracts.js"
import { ConvexCallbacks } from "./callbacks.js"
import { FreeSwitch } from "./esl.js"
import { GatewayError } from "./errors.js"
import { JanusSession, type JanusEvent } from "./janus.js"
import { gatewaySdp, metaSdp, validateIceRuntime } from "./sdp.js"

interface Call {
  browserExtension?: string
  machine: CallStateMachine
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
  if (
    !["agent", "ivr", "queue", "bot", "voicemail", "hangup"].includes(
      request.target
    )
  )
    throw new GatewayError("INVALID_ROUTE", "Unknown route target")
  for (const id of [request.ivrId, request.botId])
    if (id !== undefined && !/^[a-zA-Z0-9._:-]{1,256}$/.test(id))
      throw new GatewayError("INVALID_ROUTE", "Invalid route id")
  if (request.target === "queue")
    throw new GatewayError(
      "ROUTE_NOT_IMPLEMENTED",
      "Queue routing is not implemented",
      501
    )
  if (request.target === "agent" && !/^20\d{2}$/.test(request.extension ?? ""))
    throw new GatewayError(
      "INVALID_EXTENSION",
      "Agent extension must be 2000–2099"
    )
  if (
    request.maxDurationSeconds !== undefined &&
    (!Number.isInteger(request.maxDurationSeconds) ||
      request.maxDurationSeconds < 1 ||
      request.maxDurationSeconds > 3600)
  )
    throw new GatewayError(
      "INVALID_DURATION",
      "Duration cap must be 1–3600 seconds"
    )
  if (
    request.organizationId !== undefined &&
    !/^[a-zA-Z0-9._:-]{1,256}$/.test(request.organizationId)
  )
    throw new GatewayError("INVALID_TEAM", "Invalid team")
  if (request.codec !== undefined && !["L16", "PCMU"].includes(request.codec))
    throw new GatewayError("INVALID_CODEC", "Expected L16 or PCMU")
  if (
    request.target === "bot" &&
    (!request.organizationId ||
      (!request.botId && request.adapter !== "fake-echo"))
  )
    throw new GatewayError(
      "INVALID_BOT",
      "Bot requires team and bot session reference"
    )
  if (
    request.botId !== undefined &&
    !/^[a-zA-Z0-9._:-]{1,256}$/.test(request.botId)
  )
    throw new GatewayError("INVALID_BOT", "Invalid bot reference")
  if (
    request.silenceTimeoutSeconds !== undefined &&
    (!Number.isInteger(request.silenceTimeoutSeconds) ||
      request.silenceTimeoutSeconds < 1 ||
      request.silenceTimeoutSeconds > 300)
  )
    throw new GatewayError("INVALID_DURATION", "Invalid silence timeout")
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
  private readonly voice?: VoiceRuntime
  private readonly fs: FreeSwitch
  private readonly callbacks: ConvexCallbacks
  private sweep?: NodeJS.Timeout
  private reconnecting = false
  private readonly session: () => JanusSession
  constructor(
    private readonly options: Config,
    dependencies: {
      voice?: VoiceRuntime
      fs?: FreeSwitch
      callbacks?: ConvexCallbacks
      session?: () => JanusSession
    } = {}
  ) {
    this.voice = dependencies.voice
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
    await this.voice?.start()
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
      machine: new CallStateMachine(),
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
      ) {
        const finish = () => {
          void this.finish(
            call,
            result?.reason ?? "Janus call ended or renegotiation requested"
          )
        }
        // Routed calls prefer the anchored FreeSWITCH cause. Setup waiters must
        // consume the terminal SIP event before close() rejects them.
        if (call.routed && call.uuid) setTimeout(finish, 100).unref()
        else queueMicrotask(finish)
      }
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
  /** Browser plays the caller; the anchored leg uses the production IVR/bot runner. */
  async playground(request: { callId: string; extension: string }) {
    if (!/^20\d{2}$/.test(request.extension))
      throw new GatewayError("INVALID_EXTENSION", "Invalid browser extension")
    const existing = this.calls.get(request.callId)
    if (existing) {
      if (existing.browserExtension !== request.extension)
        throw new GatewayError("CALL_CONFLICT", "Browser call differs", 409)
      await existing.setup
      return
    }
    const call = this.allocate(request.callId, "inbound")
    call.browserExtension = request.extension
    call.uuid = randomUUID()
    call.setup = (async () => {
      try {
        await this.fs.bgapi(
          `originate {origination_uuid=${call.uuid},opensend_call_id=${call.id},media_webrtc=true,absolute_codec_string=OPUS@48000h@20i,originate_timeout=10}user/${request.extension}@${this.options.fsHost} &park()`
        )
        await this.parked(call)
        this.notify(call, { event: "media_up" })
        return { offerSdp: "" }
      } catch (error) {
        await this.finish(call, "Browser call setup failed")
        throw error
      }
    })()
    await call.setup
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
    for (let i = 0; i < (call.browserExtension ? 220 : 100); i++) {
      if (call.ending)
        throw new GatewayError("CALL_ENDED", "Call ended during setup", 409)
      if (call.uuid) {
        try {
          if (
            (await this.fs.api(
              `uuid_getvar ${call.uuid} current_application`
            )) === "park"
          )
            return
        } catch (error) {
          // bgapi acknowledges before the browser's channel is created.
          if (
            !call.browserExtension ||
            !(error instanceof GatewayError) ||
            error.code !== "ESL_ERROR" ||
            !error.message.includes("No such channel")
          )
            throw error
        }
      }
      await delay(50)
    }
    throw new GatewayError(
      "GATEWAY_TIMEOUT",
      "FreeSWITCH leg did not park",
      504
    )
  }
  private async startRecording(call: Call) {
    if (this.recordings.has(call.uuid!)) return
    await this.fs.api(
      `uuid_record ${call.uuid} start /recordings/${call.uuid}.wav`
    )
    this.recordings.set(call.uuid!, { call, expires: Infinity })
  }
  async route(request: RouteRequest) {
    validateRoute(request)
    if (
      request.target === "bot" &&
      (!this.voice ||
        (request.adapter === "fake-echo" && !this.voice.fakeEnabled))
    )
      throw new GatewayError(
        "BOT_UNAVAILABLE",
        "Voice adapter is unavailable",
        501
      )
    if (
      (request.target === "voicemail" ||
        (request.target === "ivr" && request.ivrId)) &&
      !this.voice
    )
      throw new GatewayError(
        "VOICE_UNAVAILABLE",
        "Voice controller unavailable",
        503
      )
    const call = this.get(request.callId)
    if (request.target === "hangup") {
      await this.finish(call, "Route hangup")
      return
    }
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
    try {
      if (request.target === "agent")
        await this.fs.api(
          `uuid_setvar ${call.uuid} opensend_agent ${request.extension}`
        )
      const controlled =
        !!this.voice && ["ivr", "bot", "voicemail"].includes(request.target)
      if (request.record || request.target === "voicemail") {
        if (controlled && request.target !== "voicemail")
          await this.startRecording(call)
        else {
          if (!controlled)
            await this.fs.api(`uuid_setvar ${call.uuid} opensend_record true`)
          this.recordings.set(call.uuid!, { call, expires: Infinity })
        }
      }
      if (controlled) {
        await this.fs.api(
          `sched_hangup +${request.maxDurationSeconds ?? 300} ${call.uuid} ALLOTTED_TIMEOUT`
        )
        this.voice!.prepare(
          call.id,
          call.uuid!,
          request,
          call.machine,
          (reason) => this.finish(call, reason),
          (extension) =>
            this.control({ callId: call.id, operation: "transfer", extension }),
          () => this.startRecording(call)
        )
      }
      // The authenticated route invocation is Convex's confirmation that Graph accept returned 200.
      if (!call.browserExtension)
        await Promise.all([
          call.janus.waitFor(
            (event) => event.plugindata?.data.result?.event === "media_gate"
          ),
          call.janus.message({ request: "opensend_media", enabled: true }),
        ])
      await call.machine.transition(
        request.target === "queue" ? "agent" : request.target,
        async () => {
          await this.fs.api(
            `uuid_transfer ${call.uuid} ${controlled ? "voice-control" : request.target === "agent" ? "agent-route" : "ivr-demo"} XML calling`
          )
        }
      )
      call.routed = request
      this.voice?.reportState(call.id, call.machine)
    } catch (error) {
      await this.finish(call, "Routing failed")
      throw error
    }
  }
  async control(request: AgentControl) {
    const call = this.get(request.callId)
    if (!call.routed || !call.uuid)
      throw new GatewayError("CALL_NOT_BRIDGED", "Call is not bridged", 409)
    if (request.operation === "hold" || request.operation === "resume") {
      // Gate audio locally. uuid_hold on the Janus SIP leg would re-INVITE
      // Janus and violate Meta's prohibition on renegotiation.
      if (request.operation === "resume")
        await this.fs.api(`uuid_audio ${call.uuid} stop`)
      else {
        await this.fs.api(`uuid_audio ${call.uuid} start read mute 1`)
        await this.fs.api(`uuid_audio ${call.uuid} start write mute 1`)
      }
      return
    }
    if (request.operation !== "transfer")
      throw new GatewayError("INVALID_CONTROL", "Unknown control")
    if (request.queue) {
      if (
        !request.organizationId ||
        !agentQueues(
          process.env.CALL_AGENT_QUEUES,
          request.organizationId
        ).includes(request.queue)
      )
        throw new GatewayError(
          "INVALID_QUEUE",
          "Queue is not configured for this team"
        )
    } else
      validateRoute({
        callId: request.callId,
        target: "agent",
        extension: request.extension,
      })
    await this.fs.api(`uuid_audio ${call.uuid} stop`)
    if (request.extension)
      await this.fs.api(
        `uuid_setvar ${call.uuid} opensend_agent ${request.extension}`
      )
    await this.fs.api(`sched_del ${call.uuid}`)
    await this.fs.api(`uuid_setvar ${call.uuid} hangup_after_bridge false`)
    this.voice?.beginTransfer(call.id)
    try {
      // Finish the bot bridge while the outbound controller still owns the channel.
      // Closing a socket with socket_resume=true can reset a newly executing route.
      await this.voice?.releaseForTransfer(call.id)
      await call.machine.transition("agent", async () => {
        await this.fs.api(
          `uuid_transfer ${call.uuid} ${request.queue ? `queue-${request.organizationId}-${request.queue}` : "agent-route"} XML calling`
        )
      })
      this.voice?.reportState(call.id, call.machine)
      await this.voice?.stop(call.id)
    } catch (error) {
      this.voice?.transferFailed(call.id)
      await this.finish(call, "Transfer failed")
      throw error
    }
    call.routed = {
      callId: request.callId,
      target: request.queue ? "queue" : "agent",
      extension: request.extension,
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
    call.machine.end()
    this.voice?.reportState(call.id, call.machine)
    if (call.uuid && this.fs.ready)
      await this.fs
        .api(`uuid_kill ${call.uuid} NORMAL_CLEARING`)
        .catch(() => undefined)
    await this.voice?.stop(call.id, reason)
    const recording = call.uuid && this.recordings.get(call.uuid)
    if (recording) recording.expires = Date.now() + 60000
    this.ended.set(call.id, Date.now() + 300000)
    this.notify(call, { event: "hangup", reason })
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
    if (
      ["CHANNEL_HANGUP", "CHANNEL_HANGUP_COMPLETE"].includes(
        event["Event-Name"]
      ) &&
      event["Unique-ID"] === call.uuid
    )
      void this.finish(call, event["Hangup-Cause"] ?? "SIP hangup")
  }
  async healthy() {
    if (!this.fs.ready || (this.voice && !this.voice.healthy)) return false
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
    await this.voice?.close()
    this.fs.close()
  }
}
