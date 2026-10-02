import { signRequest } from "./auth.js"
import type { AgentControl, GatewayApi, RouteRequest } from "./contracts.js"
import { GatewayError } from "./errors.js"

/** Import into the calling-core action layer; no framework or Convex dependency. */
export class CallGatewayClient implements GatewayApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string
  ) {}
  protected async post<T>(
    path: string,
    data: object,
    signal?: AbortSignal
  ): Promise<T> {
    const body = JSON.stringify(data)
    const url = new URL(path, this.baseUrl)
    const response = await fetch(url, {
      method: "POST",
      body,
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(30000),
      headers: {
        "content-type": "application/json",
        ...signRequest(this.secret, "POST", url.pathname, body),
      },
    })
    const chunks: Uint8Array[] = []
    let bytes = 0
    const reader = response.body?.getReader()
    if (reader)
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > 128 * 1024) {
            await reader.cancel()
            throw new Error("Signed response exceeds 128 KiB")
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
    const raw = Buffer.concat(chunks).toString("utf8")
    const result = JSON.parse(raw) as T & {
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
  async normalizePrompt(audio: Blob, attempt = 0): Promise<Blob> {
    if (!audio.size || audio.size > 16 * 1024 * 1024)
      throw new Error("Invalid prompt size")
    const path = "/prompts/normalize"
    const body = JSON.stringify({
      audio: Buffer.from(await audio.arrayBuffer()).toString("base64"),
    })
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "content-type": "application/json",
        ...signRequest(this.secret, "POST", path, body),
      },
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 503 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 4 ** attempt))
        return this.normalizePrompt(audio, attempt + 1)
      }
      throw new Error(
        "IVR audio conversion failed; check the calling gateway and retry"
      )
    }
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const reader = response.body!.getReader()
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 16 * 1024 * 1024)
          throw new Error("Converted prompt exceeds 16 MiB")
        chunks.push(new Uint8Array(value))
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    const result = new Blob(chunks, { type: "audio/wav" })
    const header = new DataView(await result.slice(0, 44).arrayBuffer())
    if (
      header.byteLength < 44 ||
      header.getUint32(24, true) !== 48000 ||
      header.getUint16(20, true) !== 1 ||
      header.getUint16(22, true) !== 1 ||
      header.getUint16(34, true) !== 16
    )
      throw new Error("Invalid normalized WAV")
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
  async playground(request: { callId: string; extension: string }) {
    await this.post("/playground", request)
  }
  async healthy() {
    const response = await fetch(new URL("/healthz", this.baseUrl), {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  }
}
