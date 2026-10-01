import { signRequest } from "./auth.js"
import type { AgentControl, GatewayApi, RouteRequest } from "./contracts.js"
import { GatewayError } from "./errors.js"

/** Import into the calling-core action layer; no framework or Convex dependency. */
export class CallGatewayClient implements GatewayApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string
  ) {}
  private async post<T>(path: string, data: object): Promise<T> {
    const body = JSON.stringify(data)
    const url = new URL(path, this.baseUrl)
    const response = await fetch(url, {
      method: "POST",
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "content-type": "application/json",
        ...signRequest(this.secret, "POST", url.pathname, body),
      },
    })
    const result = (await response.json()) as T & {
      error?: { code: string; message: string }
    }
    if (!response.ok)
      throw new GatewayError(
        result.error?.code ?? "GATEWAY_ERROR",
        result.error?.message ?? "Gateway request failed",
        response.status
      )
    return result
  }
  inbound(offerSdp: string, callId: string) {
    return this.post<{ answerSdp: string }>("/inbound", { offerSdp, callId })
  }
  outbound(callId: string) {
    return this.post<{ offerSdp: string }>("/outbound", { callId })
  }
  async remoteAnswer(callId: string, sdp: string) {
    await this.post("/remoteAnswer", { callId, sdp })
  }
  async hangup(callId: string) {
    await this.post("/hangup", { callId })
  }
  async route(request: RouteRequest) {
    await this.post("/route", request)
  }
  agentSession(sessionId: string) {
    return this.post<import("./agents.js").AgentCredential>("/agents/session", {
      sessionId,
    })
  }
  async revokeAgent(sessionId: string) {
    await this.post("/agents/revoke", { sessionId })
  }
  async control(request: AgentControl) {
    await this.post("/control", request)
  }
  async healthy() {
    const response = await fetch(new URL("/healthz", this.baseUrl), {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  }
}
