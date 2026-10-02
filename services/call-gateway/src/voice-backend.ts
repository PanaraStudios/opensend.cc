import { validateTool, type VoiceSessionConfig } from "./voice/catalog.js"
import { randomUUID } from "node:crypto"
import { IvrBackend } from "./ivr-runner.js"
import type { VoiceToolCall, VoiceTranscript } from "./voice-adapter.js"
import type { CallState } from "./call-state.js"

export type VoiceEvent =
  | {
      type: "tool_call"
      toolId: string
      toolName: string
      latencyMs?: number
      error?: string
      status: "requested" | "succeeded" | "failed"
    }
  | { type: "playback_done"; turnId: string; playedMs: number }
  | { type: "hangup"; reason: string }
  | { type: "usage"; usage: import("./voice/base.js").VoiceUsage }
  | { type: "latency"; turnId: string; latencyMs: number }
  | {
      type: "bot_completed"
      outcome:
        | "completed"
        | "transferred_agent"
        | "transferred_ivr"
        | "ended_by_bot"
        | "caller_hangup"
        | "failed"
      summary: string
      endedAt?: number
      usage: import("./voice/base.js").VoiceUsage
    }
  | { type: "state"; state: CallState }
  | { type: "ivr_digits"; digits: string }
  | { type: "transcript"; transcript: VoiceTranscript }
  | { type: "barge_in"; playedMs: number; flushedMs: number; turnId?: string }
  | {
      type: "media"
      codec: "L16" | "PCMU"
      received: number
      sent: number
      playedMs: number
      lost: number
      late: number
      maxTickDelayMs: number
      firstInputMs?: number
      firstOutputMs?: number
    }

export interface VoiceToolRequest {
  version: 1
  callId: string
  organizationId: string
  toolCall: VoiceToolCall
}
export type VoiceToolResult =
  { ok: true; result: unknown } | { ok: false; error: string }

/** Uses the same signed JSON client as calling-core; destinations are fixed. */
export class VoiceBackend extends IvrBackend {
  async session(
    callId: string,
    organizationId: string
  ): Promise<VoiceSessionConfig> {
    return this.post(
      "/calling/gateway/voice/session",
      { version: 1, callId, organizationId },
      AbortSignal.timeout(5000)
    )
  }
  async event(callId: string, event: VoiceEvent) {
    await this.post(
      "/calling/gateway/voice/events",
      {
        version: 1,
        eventId: randomUUID(),
        callId,
        timestamp: Date.now(),
        ...event,
      },
      AbortSignal.timeout(5000)
    )
  }
  async tool(
    request: VoiceToolRequest,
    signal: AbortSignal
  ): Promise<VoiceToolResult> {
    const response = await this.post<VoiceToolResult>(
      "/calling/gateway/voice/tools",
      request,
      signal
    )
    if (
      !response ||
      typeof response.ok !== "boolean" ||
      (!response.ok && typeof response.error !== "string") ||
      (response.ok && !("result" in response))
    )
      throw new Error("Invalid voice tool response")
    return response
  }
}

export { validateTool } from "./voice/catalog.js"

/** Per-call deduplication, bounded concurrency, and cancellation on hangup.
 * The backend must re-authorize call/team ownership and durably deduplicate id. */
export class VoiceTools {
  private readonly requests = new Map<
    string,
    { body: string; result: Promise<VoiceToolResult> }
  >()
  private active = 0
  private readonly abort = new AbortController()
  constructor(
    private readonly backend: VoiceBackend,
    private readonly callId: string,
    private readonly organizationId: string
  ) {}
  async run(toolCall: VoiceToolCall): Promise<VoiceToolResult> {
    if (this.abort.signal.aborted) throw new Error("Call ended")
    validateTool(toolCall)
    const body = JSON.stringify(toolCall)
    const previous = this.requests.get(toolCall.id)
    if (previous) {
      if (previous.body !== body)
        throw new Error("Tool id reused with different arguments")
      return previous.result
    }
    if (this.active >= 8 || this.requests.size >= 128)
      throw new Error("Tool limit exceeded")
    this.active++
    const result = this.backend
      .tool(
        {
          version: 1,
          callId: this.callId,
          organizationId: this.organizationId,
          toolCall,
        },
        AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)])
      )
      .finally(() => {
        this.active--
      })
    this.requests.set(toolCall.id, { body, result })
    return result
  }
  stop() {
    this.abort.abort()
  }
}
