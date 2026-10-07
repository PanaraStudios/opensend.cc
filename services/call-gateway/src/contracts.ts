export type RouteTarget =
  "agent" | "ivr" | "queue" | "bot" | "voicemail" | "hangup"
export interface RouteRequest {
  callId: string
  target: RouteTarget
  ivrId?: string
  botId?: string
  extension?: string
  record?: boolean
  organizationId?: string
  adapter?: "fake-echo"
  codec?: "L16" | "PCMU"
  silenceTimeoutSeconds?: number
  maxDurationSeconds?: number
  /** Epoch ms when the call was answered. Convex sends `connectedAt`. */
  answeredAt?: number
}
export interface GatewayApi {
  inbound(offerSdp: string, callId: string): Promise<{ answerSdp: string }>
  outbound(callId: string): Promise<{ offerSdp: string }>
  remoteAnswer(callId: string, sdp: string): Promise<void>
  hangup(callId: string): Promise<void>
  route(request: RouteRequest): Promise<void>
  playground?(request: { callId: string; extension: string }): Promise<void>
  healthy(): Promise<boolean>
}
export type CallbackPayload =
  | { event: "answer_ready"; answerSdp: string }
  | { event: "offer_ready"; offerSdp: string }
  | { event: "media_up" }
  | { event: "heartbeat" }
  | { event: "hangup"; reason: string }
  | { event: "recording_ready"; recordingFile: string }
export type GatewayCallback = CallbackPayload & {
  version: 1
  eventId: string
  callId: string
  timestamp: number
}

export interface AgentControl {
  callId: string
  organizationId?: string
  operation: "hold" | "resume" | "transfer"
  extension?: string
  queue?: string
}
