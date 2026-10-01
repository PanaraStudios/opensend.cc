import { IvrRunner } from "./ivr-runner.js"
import type { RouteRequest } from "./contracts.js"
import { CallStateMachine } from "./call-state.js"
import { OutboundEslServer, type OutboundCall } from "./outbound-esl.js"
import { FakeEchoAdapter } from "./voice-adapter.js"
import { VoiceBackend, VoiceTools, type VoiceEvent } from "./voice-backend.js"
import { VoiceMediaEndpoint } from "./voice-media.js"

interface ControlledCall {
  callId: string
  uuid: string
  route: RouteRequest
  machine: CallStateMachine
  end: (reason: string) => Promise<void>
  socket?: OutboundCall
  releaseMedia?: () => Promise<void>
  tools?: VoiceTools
  abort: AbortController
  stopped: boolean
  ready: Promise<void>
  commit: () => void
}

export class VoiceRuntime {
  private readonly calls = new Map<string, ControlledCall>()
  private readonly outbound = new OutboundEslServer(async (socket, headers) => {
    const call = this.calls.get(headers.variable_opensend_call_id)
    if (!call || call.uuid !== socket.uuid || call.stopped || call.socket)
      throw new Error("Unknown outbound channel")
    call.socket = socket
    socket.once("close", () => {
      if (!call.stopped) void call.end("Outbound ESL disconnected")
    })
    socket.on("event", (event) => {
      if (
        ["CHANNEL_HANGUP", "CHANNEL_HANGUP_COMPLETE"].includes(
          event["Event-Name"]
        )
      )
        void call.end(event["Hangup-Cause"] ?? "SIP hangup")
    })
    try {
      await call.ready
      if (!call.stopped) await this.run(call, socket)
    } catch (error) {
      if (call.stopped) return
      console.error(
        "Voice control failed",
        call.callId,
        error instanceof Error ? error.message : "Unknown control error"
      )
      await call.end("Voice control failed")
    }
  })
  constructor(
    private readonly options: { port: number; fakeEnabled: boolean },
    private readonly media: VoiceMediaEndpoint,
    private readonly backend: VoiceBackend
  ) {}
  get healthy() {
    return this.media.healthy
  }
  get fakeEnabled() {
    return this.options.fakeEnabled
  }
  async start() {
    await this.media.start()
    await this.outbound.listen(this.options.port)
  }
  prepare(
    callId: string,
    uuid: string,
    route: RouteRequest,
    machine: CallStateMachine,
    end: ControlledCall["end"]
  ) {
    let commit!: () => void
    const ready = new Promise<void>((resolve) => {
      commit = resolve
    })
    this.calls.set(callId, {
      callId,
      uuid,
      route,
      machine,
      end,
      abort: new AbortController(),
      stopped: false,
      ready,
      commit,
    })
  }
  private event(call: ControlledCall, event: VoiceEvent) {
    // Timing metadata stays useful before the 8d-2 backend receiver is installed.
    if (event.type !== "transcript")
      console.log(
        JSON.stringify({ callId: call.callId, timestamp: Date.now(), ...event })
      )
    void this.backend
      .event(call.callId, event)
      .catch(() => console.error(`Voice event delivery failed (${event.type})`))
  }
  private async run(call: ControlledCall, socket: OutboundCall) {
    const target = call.route.target
    if (target === "ivr" && call.route.ivrId) {
      const runner = new IvrRunner(this.backend)
      await runner.run({
        callId: call.callId,
        ivrId: call.route.ivrId,
        socket,
        signal: call.abort.signal,
        handoff: async (decision) => {
          if (call.stopped) return
          const action = decision.action
          if (action.kind === "agents") {
            call.stopped = true
            try {
              await call.machine.transition("agent", async () => {
                await socket.api(
                  `uuid_setvar ${socket.uuid} opensend_agent ${decision.extension}`
                )
                await socket.api(
                  `uuid_transfer ${socket.uuid} agent-route XML calling`
                )
              })
            } catch (error) {
              if (!call.abort.signal.aborted) call.stopped = false
              throw error
            }
            this.event(call, { type: "state", state: call.machine.state })
          } else if (action.kind === "bot" || action.kind === "voicemail") {
            const next = action.kind === "bot" ? "bot" : "voicemail"
            await call.machine.transition(next, async () => {})
            call.route = {
              ...call.route,
              target: next,
              organizationId: decision.organizationId,
              ...(action.kind === "bot" ? { botId: action.botId } : {}),
            }
            this.event(call, { type: "state", state: call.machine.state })
            await this.run(call, socket)
          } else {
            if (action.kind === "playAndHangup") {
              const { cachedPrompt } = await import("./ivr-runner.js")
              await socket.play(cachedPrompt(decision.promptUrl!))
            }
            await call.end("IVR completed")
          }
        },
      })
    } else if (target === "ivr") {
      while (!call.stopped && call.machine.state === "ivr") {
        const digits = await socket.playAndGetDigits(
          "/opt/freeswitch/sounds/calling-welcome.wav",
          "/opt/freeswitch/sounds/calling-invalid.wav"
        )
        if (call.stopped) return
        this.event(call, { type: "ivr_digits", digits })
        if (digits === "1") await socket.play("tone_stream://%(2000,0,440)")
        else if (digits !== "2") {
          await call.end("IVR retries exhausted")
          return
        }
      }
    } else if (target === "voicemail") {
      await socket.play("tone_stream://%(200,0,1000)")
      if (call.stopped) return
      await socket.record("start")
      await socket.execute("park", "", 3600000)
    } else if (target === "bot") {
      if (!this.options.fakeEnabled || call.route.adapter !== "fake-echo")
        throw new Error("No provider adapter installed")
      const adapter = new FakeEchoAdapter()
      const tools = (call.tools = new VoiceTools(
        this.backend,
        call.callId,
        call.route.organizationId!
      ))
      adapter.onToolCall((toolCall) => {
        void tools
          .run(toolCall)
          .then((result) => {
            if (!call.stopped) adapter.sendToolResult(toolCall.id, result)
          })
          .catch(() => {
            if (!call.stopped)
              adapter.sendToolResult(toolCall.id, {
                ok: false,
                error: "Tool execution failed",
              })
          })
      })
      adapter.onTranscript((transcript) => {
        if (!call.stopped) this.event(call, { type: "transcript", transcript })
      })
      const reserved = this.media.reserve({
        adapter,
        event: (event) => this.event(call, event),
        barge: async () => {
          const application = await socket.api(
            `uuid_getvar ${socket.uuid} current_application`
          )
          if (["playback", "play_and_get_digits"].includes(application))
            await socket.break()
        },
        end: (reason) => {
          if (reason === "Bot SIP leg ended") this.afterAnchor(call, reason)
          else if (!call.stopped) void call.end(reason)
        },
        attach: async (session) => {
          if (call.stopped) {
            await session.stop()
            return
          }
          await session.start()
        },
      })
      call.releaseMedia = reserved.release
      // Explicit per-leg codecs permit transcoding without changing Meta's Opus leg.
      const codecs =
        call.route.codec === "PCMU" ? "PCMU" : "L16@16000h@20i,PCMU"
      await socket.execute(
        "bridge",
        `{absolute_codec_string='${codecs}',rtp_secure_media=false,media_webrtc=false,hangup_after_bridge=true,originate_timeout=10}sofia/internal/${reserved.uri.slice(4)}`,
        3600000
      )
      this.afterAnchor(call, "Bot bridge completed")
    }
  }
  private afterAnchor(call: ControlledCall, reason: string) {
    // SIP BYE/application completion can precede the anchor's hangup event.
    // Prefer FreeSWITCH's cause (especially ALLOTTED_TIMEOUT) when available.
    setTimeout(() => {
      if (!call.stopped) void call.end(reason)
    }, 100).unref()
  }
  reportState(callId: string, machine: CallStateMachine) {
    const call = this.calls.get(callId)
    if (call) {
      call.commit()
      this.event(call, { type: "state", state: machine.state })
    }
  }
  beginTransfer(callId: string) {
    const call = this.calls.get(callId)
    if (call) {
      call.abort.abort()
      call.stopped = true
      call.tools?.stop()
    }
  }
  async stop(callId: string) {
    const call = this.calls.get(callId)
    if (!call) return
    call.abort.abort()
    call.stopped = true
    call.tools?.stop()
    call.commit()
    await call.releaseMedia?.()
    call.socket?.close()
    this.calls.delete(callId)
  }
  async close() {
    for (const id of this.calls.keys()) await this.stop(id)
    await this.outbound.close()
    await this.media.close()
  }
}
