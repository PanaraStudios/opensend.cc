import { PipecatAdapter } from "./voice/index.js"
import type { VoiceAdapterBase, VoiceUsage } from "./voice/base.js"
import type { VoiceAgentAdapter } from "./voice-adapter.js"
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
  transfer?: (extension: string) => Promise<void>
  adapter?: VoiceAgentAdapter & {
    summarize?: (text: string) => Promise<string>
  }
  transcript?: string
  usage?: VoiceUsage
  outcome?: "transferred_agent" | "ended_by_bot" | "failed"
  silence?: NodeJS.Timeout
  lastActivity?: number
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
    private readonly options: {
      port: number
      fakeEnabled: boolean
      agentUrl?: string
      agentSecret?: string
    },
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
    end: ControlledCall["end"],
    transfer?: ControlledCall["transfer"]
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
      transfer,
      stopped: false,
      ready,
      commit,
    })
  }
  private event(call: ControlledCall, event: VoiceEvent) {
    // Timing metadata stays useful before the 8d-2 backend receiver is installed.
    if (["state", "barge_in", "media", "latency"].includes(event.type))
      console.log(
        JSON.stringify({ callId: call.callId, timestamp: Date.now(), ...event })
      )
    void this.backend
      .event(call.callId, event)
      .catch(() => console.error(`Voice event delivery failed (${event.type})`))
  }
  private async run(call: ControlledCall, socket: OutboundCall) {
    const target = call.route.target
    if (target === "ivr") {
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
      const fake = call.route.adapter === "fake-echo"
      if (fake && !this.options.fakeEnabled)
        throw new Error("Fake adapter disabled")
      if (
        !fake &&
        (!call.route.botId ||
          !this.options.agentSecret ||
          !this.options.agentUrl)
      )
        throw new Error("Voice-agent is not configured")
      const adapter = (call.adapter = fake
        ? new FakeEchoAdapter()
        : new PipecatAdapter(
            {
              callId: call.callId,
              organizationId: call.route.organizationId!,
              botId: call.route.botId!,
            },
            { url: this.options.agentUrl!, secret: this.options.agentSecret! }
          ))
      call.transcript = ""
      call.usage = {}
      call.lastActivity = Date.now()
      if (!fake) {
        call.silence = setInterval(() => {
          if (
            !call.stopped &&
            Date.now() - call.lastActivity! >=
              (call.route.silenceTimeoutSeconds ?? 20) * 1000
          )
            void call.end("Bot silence timeout")
        }, 1000)
        const provider = adapter as VoiceAdapterBase
        provider.onActivity(() => {
          call.lastActivity = Date.now()
        })
        provider.onUsage((usage) => {
          for (const [key, value] of Object.entries(usage))
            call.usage![key as keyof VoiceUsage] =
              (call.usage![key as keyof VoiceUsage] ?? 0) + value
          this.event(call, { type: "usage", usage })
        })
        provider.onLatency((timing) =>
          this.event(call, { type: "latency", ...timing })
        )
      }
      adapter.onAudio(() => {
        call.lastActivity = Date.now()
      })
      const tools = (call.tools = new VoiceTools(
        this.backend,
        call.callId,
        call.route.organizationId!
      ))
      adapter.onToolCall((toolCall) => {
        void tools
          .run(toolCall)
          .then((result) => {
            if (call.stopped) return
            adapter.sendToolResult(toolCall.id, result)
            if (result.ok && !fake) {
              const action = result.result as {
                action?: string
                extension?: string
              }
              if (
                toolCall.name === "transfer_to_agent" &&
                action.action === "transfer_to_agent" &&
                /^20\d{2}$/.test(action.extension ?? "")
              ) {
                call.outcome = "transferred_agent"
                void call
                  .transfer?.(action.extension!)
                  .catch(() => call.end("Bot transfer failed"))
              } else if (
                toolCall.name === "end_call" &&
                action.action === "end_call"
              ) {
                call.outcome = "ended_by_bot"
                setTimeout(() => {
                  if (!call.stopped) void call.end("Ended by bot")
                }, 3000).unref()
              }
            }
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
        if (!call.stopped) {
          call.lastActivity = Date.now()
          if (transcript.final)
            call.transcript = (
              call.transcript + `\n${transcript.role}: ${transcript.text}`
            ).slice(-24000)
          this.event(call, { type: "transcript", transcript })
        }
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
          else if (!call.stopped) {
            console.error("Voice session ended", call.callId, reason)
            void call.end(reason)
          }
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
      call.stopped = true
      call.tools?.stop()
    }
  }
  transferFailed(callId: string) {
    const call = this.calls.get(callId)
    if (call) call.outcome = "failed"
  }
  async stop(callId: string, reason = "Call ended") {
    const call = this.calls.get(callId)
    if (!call) return
    const endedAt = Date.now()
    call.stopped = true
    clearInterval(call.silence)
    call.tools?.stop()
    call.commit()
    if (call.route.botId) {
      let summary = ""
      try {
        summary = (await call.adapter?.summarize?.(call.transcript ?? "")) ?? ""
      } catch {
        /* Summary failures must not delay hangup or leak provider errors. */
      }
      const outcome =
        call.outcome ??
        (/failed|disconnect|unavailable/i.test(reason)
          ? "failed"
          : /timeout|ALLOTTED_TIMEOUT/i.test(reason)
            ? "completed"
            : "caller_hangup")
      await this.backend
        .event(call.callId, {
          type: "bot_completed",
          outcome,
          summary,
          endedAt,
          usage: {
            ...call.usage,
            ...(call.adapter instanceof PipecatAdapter
              ? call.adapter.usage
              : {}),
          },
        })
        .catch(() => console.error("Bot completion delivery failed"))
    }
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
