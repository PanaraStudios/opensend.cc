import { EventEmitter } from "node:events"

export type SampleRate = 8000 | 16000 | 24000
/** PCM16 little endian, mono. timestampMs is relative to the media session. */
export interface VoiceAudio {
  pcm: Buffer
  sampleRate: SampleRate
  timestampMs: number
  turnId: string
}
export interface VoiceToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}
export interface VoiceTranscript {
  role: "caller" | "agent"
  text: string
  final: boolean
  timestampMs: number
}
export interface VoiceAgentAdapter {
  readonly kind: "realtime-ws" | "realtime-sip" | "pipeline"
  start(): Promise<void>
  pushAudio(audio: VoiceAudio): void
  onAudio(listener: (audio: VoiceAudio) => void): () => void
  onBargeIn(listener: () => void): () => void
  onToolCall(listener: (call: VoiceToolCall) => void): () => void
  onTranscript(listener: (transcript: VoiceTranscript) => void): () => void
  onEnd(listener: (reason: string) => void): () => void
  sendToolResult(id: string, result: unknown): void
  interrupt(playedMs: number): void
  stop(): Promise<void>
}

/** Deliberately deterministic, opt-in fixture. No network/provider credentials. */
export class FakeEchoAdapter implements VoiceAgentAdapter {
  readonly kind = "realtime-ws" as const
  private readonly events = new EventEmitter()
  private frames = 0
  private stopped = false
  private listen<T>(event: string, listener: (value: T) => void) {
    const handle = (value: unknown) => listener(value as T)
    this.events.on(event, handle)
    return () => {
      this.events.off(event, handle)
    }
  }
  onAudio(listener: (audio: VoiceAudio) => void) {
    return this.listen("audio", listener)
  }
  onBargeIn(listener: () => void) {
    return this.listen("barge", listener)
  }
  onToolCall(listener: (call: VoiceToolCall) => void) {
    return this.listen("tool", listener)
  }
  onTranscript(listener: (transcript: VoiceTranscript) => void) {
    return this.listen("transcript", listener)
  }
  onEnd(listener: (reason: string) => void) {
    return this.listen("end", listener)
  }
  async start() {
    // Long greeting queues enough audio to prove that interruption removes it.
    const pcm = Buffer.alloc(24000 * 2 * 3)
    for (let i = 0; i < pcm.length / 2; i++)
      pcm.writeInt16LE(
        Math.round(4000 * Math.sin((2 * Math.PI * 880 * i) / 24000)),
        i * 2
      )
    this.events.emit("audio", {
      pcm,
      sampleRate: 24000,
      timestampMs: 0,
      turnId: "greeting",
    })
  }
  pushAudio(audio: VoiceAudio) {
    if (this.stopped) return
    let energy = 0
    for (let i = 0; i < audio.pcm.length; i += 2)
      energy += audio.pcm.readInt16LE(i) ** 2
    if (energy / Math.max(1, audio.pcm.length / 2) < 10000) return
    this.frames++
    if (this.frames === 10) this.events.emit("barge")
    if (this.frames >= 10)
      this.events.emit("audio", { ...audio, turnId: "echo" })
    if (this.frames === 20)
      this.events.emit("tool", {
        id: "echo-tool-1",
        name: "lookup_contact",
        arguments: {},
      })
  }
  sendToolResult(id: string, result: unknown) {
    if (!this.stopped)
      this.events.emit("transcript", {
        role: "agent",
        text: JSON.stringify({ id, result }),
        final: true,
        timestampMs: this.frames * 20,
      })
  }
  interrupt(playedMs: number) {
    if (!this.stopped)
      this.events.emit("transcript", {
        role: "agent",
        text: `interrupted:${playedMs}`,
        final: true,
        timestampMs: this.frames * 20,
      })
  }
  async stop() {
    this.stopped = true
    this.events.removeAllListeners()
  }
}
