import { EventEmitter } from "node:events"
import type {
  VoiceAgentAdapter,
  VoiceAudio,
  VoiceToolCall,
  VoiceTranscript,
} from "../voice-adapter.js"
export interface VoiceUsage {
  inputTokens?: number
  outputTokens?: number
  audioSeconds?: number
  ttsCharacters?: number
}
export abstract class VoiceAdapterBase implements VoiceAgentAdapter {
  abstract readonly kind: "realtime-ws" | "pipeline"
  protected readonly events = new EventEmitter()
  protected stopped = false
  protected readonly origin = performance.now()
  protected now() {
    return Math.round(performance.now() - this.origin)
  }
  private listen<T>(event: string, listener: (value: T) => void) {
    this.events.on(event, listener)
    return () => {
      this.events.off(event, listener)
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
  onTranscript(listener: (line: VoiceTranscript) => void) {
    return this.listen("transcript", listener)
  }
  onEnd(listener: (reason: string) => void) {
    return this.listen("end", listener)
  }
  onToolObserved(
    listener: (
      tool: Extract<
        import("../voice-backend.js").VoiceEvent,
        { type: "tool_call" }
      >
    ) => void
  ) {
    return this.listen("tool_observed", listener)
  }
  onActivity(listener: () => void) {
    return this.listen("activity", listener)
  }
  onUsage(listener: (usage: VoiceUsage) => void) {
    return this.listen("usage", listener)
  }
  onLatency(listener: (timing: { turnId: string; latencyMs: number }) => void) {
    return this.listen("latency", listener)
  }
  abstract start(): Promise<void>
  abstract pushAudio(audio: VoiceAudio): void
  abstract sendToolResult(id: string, result: unknown): void
  abstract interrupt(playedMs: number): void
  abstract stop(): Promise<void>
}
