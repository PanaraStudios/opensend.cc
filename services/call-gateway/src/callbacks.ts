import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { signRequest } from "./auth.js"
import type { CallbackPayload, GatewayCallback } from "./contracts.js"

export class ConvexCallbacks {
  private readonly url: URL
  constructor(
    baseUrl: string,
    private readonly secret: string,
    private readonly send = fetch
  ) {
    this.url = new URL(`${baseUrl.replace(/\/$/, "")}/calling/gateway/events`)
    if (
      !["http:", "https:"].includes(this.url.protocol) ||
      this.url.username ||
      this.url.password ||
      this.url.search ||
      this.url.hash
    )
      throw new Error("Invalid CALL_GATEWAY_CONVEX_HTTP_URL")
  }
  async emit(callId: string, payload: CallbackPayload): Promise<void> {
    const event: GatewayCallback = {
      version: 1,
      eventId: randomUUID(),
      callId,
      timestamp: Date.now(),
      ...payload,
    }
    const body = JSON.stringify(event)
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const response = await this.send(this.url, {
          method: "POST",
          body,
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: {
            "content-type": "application/json",
            ...signRequest(this.secret, "POST", this.url.pathname, body),
          },
        })
        await response.body?.cancel()
        if (response.ok) return
        if (response.status < 500 && response.status !== 429) break
      } catch {
        /* Transport failures retry with the same eventId and a fresh nonce. */
      }
      if (attempt < 4) await delay(250 * 2 ** attempt)
    }
    throw new Error(
      `Callback delivery failed: ${event.eventId} (${event.event})`
    )
  }
}
