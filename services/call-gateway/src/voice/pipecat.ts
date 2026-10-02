import { createHmac, randomUUID } from "node:crypto"
import type WebSocket from "ws"
import type { VoiceAudio } from "../voice-adapter.js"
import { VoiceAdapterBase, type VoiceUsage } from "./base.js"
import {
  json,
  opened,
  providerSocket,
  send,
  type SocketFactory,
} from "./socket.js"
export interface PipecatSession {
  callId: string
  organizationId: string
  botId: string
}
export function sessionToken(
  secret: string,
  session: PipecatSession,
  now = Date.now()
) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret))
    throw new Error("Invalid voice-agent secret")
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      ...session,
      expiresAt: now + 45000,
      nonce: randomUUID(),
    })
  ).toString("base64url")
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`
}
/** The gateway knows only our audio/control protocol; all providers live in Pipecat. */
export class PipecatAdapter extends VoiceAdapterBase {
  readonly kind = "pipeline" as const
  private socket?: WebSocket
  private turnId?: string
  private cancelled = new Set<string>()
  private received = 0
  private summary = ""
  private finalUsage: VoiceUsage = {}
  private ready = false
  private completion?: () => void
  private finishing?: Promise<void>
  private pending = new Map<string, string>()
  constructor(
    private readonly session: PipecatSession,
    private readonly options: { url: string; secret: string },
    private readonly factory: SocketFactory = providerSocket
  ) {
    super()
  }
  async start() {
    const socket = (this.socket = this.factory(this.options.url, {}))
    let resolveReady!: () => void, rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void ready.catch(() => undefined)
    socket.on("error", () => {
      rejectReady(new Error("Voice-agent connection failed"))
      if (!this.stopped)
        this.events.emit("end", "Voice-agent connection failed")
    })
    socket.on("close", () => {
      rejectReady(new Error("Voice-agent connection closed"))
      this.completion?.()
      if (!this.stopped && !this.finishing)
        this.events.emit("end", "Voice-agent connection closed")
    })
    socket.on("message", (raw, binary) => {
      if (this.stopped) return
      try {
        if (binary) {
          const pcm = Buffer.from(raw as Buffer)
          if (pcm.length % 2 || pcm.length > 64000)
            throw new Error("Invalid PCM")
          if (!this.ready || !this.turnId || this.cancelled.has(this.turnId))
            return
          this.events.emit("audio", {
            pcm,
            sampleRate: 16000,
            timestampMs: this.received / 32,
            turnId: this.turnId,
          })
          this.received += pcm.length
          return
        }
        const data = json(raw)
        switch (data.type) {
          case "activity":
            this.events.emit("activity")
            break
          case "ready":
            this.ready = true
            resolveReady()
            break
          case "mark":
            if (typeof data.turnId !== "string" || data.turnId.length > 128)
              throw new Error("Invalid turn")
            if (!this.cancelled.has(data.turnId)) this.turnId = data.turnId
            break
          case "clear":
            if (this.turnId) {
              this.cancelled.add(this.turnId)
              while (this.cancelled.size > 128)
                this.cancelled.delete(this.cancelled.values().next().value!)
            }
            this.events.emit("barge")
            this.turnId = undefined
            break
          case "transcript":
            if (
              (data.role !== "caller" && data.role !== "agent") ||
              typeof data.text !== "string" ||
              data.text.length > 16000 ||
              typeof data.final !== "boolean" ||
              typeof data.timestampMs !== "number"
            )
              throw new Error("Invalid transcript")
            this.events.emit("transcript", {
              role: data.role,
              text: data.text,
              final: data.final,
              timestampMs: data.timestampMs,
            })
            break
          case "tool_call":
            if (
              typeof data.id !== "string" ||
              typeof data.name !== "string" ||
              !data.arguments ||
              typeof data.arguments !== "object" ||
              Array.isArray(data.arguments)
            )
              throw new Error("Invalid tool")
            this.pending.set(data.id, data.name)
            this.events.emit("tool", {
              id: data.id,
              name: data.name,
              arguments: data.arguments,
            })
            break
          case "usage":
            this.events.emit("usage", data.usage)
            break
          case "latency":
            this.events.emit("latency", {
              turnId: String(data.turnId),
              latencyMs: Number(data.latencyMs),
            })
            break
          case "end":
            this.summary =
              typeof data.summary === "string"
                ? data.summary.slice(0, 4000)
                : ""
            this.finalUsage = (data.usage ?? {}) as VoiceUsage
            this.completion?.()
            if (!this.finishing)
              this.events.emit(
                "end",
                typeof data.reason === "string"
                  ? data.reason
                  : "Voice-agent ended"
              )
            break
          default:
            throw new Error("Unknown voice-agent control")
        }
      } catch {
        rejectReady(new Error("Invalid voice-agent message"))
        this.events.emit("end", "Invalid voice-agent message")
      }
    })
    const timer = setTimeout(() => {
      rejectReady(new Error("Voice-agent setup timed out"))
      socket.terminate()
    }, 10000)
    try {
      await opened(socket)
      send(socket, {
        type: "start",
        callId: this.session.callId,
        sessionToken: sessionToken(this.options.secret, this.session),
      })
      await ready
    } finally {
      clearTimeout(timer)
    }
  }
  pushAudio(audio: VoiceAudio) {
    if (this.stopped || !this.ready || !this.socket) return
    if (
      audio.sampleRate !== 16000 ||
      audio.pcm.length % 2 ||
      this.socket.bufferedAmount > 1024 * 1024
    )
      throw new Error("Invalid media or voice-agent backpressure")
    this.socket.send(audio.pcm)
  }
  sendToolResult(id: string, result: unknown) {
    if (!this.stopped && this.pending.delete(id))
      send(this.socket, { type: "tool_result", id, result })
  }
  interrupt(playedMs: number) {
    send(this.socket, { type: "played_ms", turnId: this.turnId, playedMs })
  }
  async summarize(transcript?: string): Promise<string> {
    void transcript
    await this.finish()
    return this.summary
  }
  get usage() {
    return this.finalUsage
  }
  private finish() {
    if (this.finishing) return this.finishing
    this.finishing = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 6000)
      this.completion = () => {
        clearTimeout(timer)
        resolve()
      }
      if (!send(this.socket, { type: "end", reason: "Call ended" }))
        this.completion()
    })
    return this.finishing
  }
  async stop() {
    await this.finish()
    this.stopped = true
    this.ready = false
    this.pending.clear()
    this.socket?.close()
    this.events.removeAllListeners()
  }
}
