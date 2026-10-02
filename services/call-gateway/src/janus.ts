import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { GatewayError } from "./errors.js"

export interface JanusEvent {
  janus: string
  transaction?: string
  sender?: number
  data?: { id: number }
  error?: { reason: string }
  plugindata?: {
    data: { error?: string; result?: { event: string; reason?: string } }
  }
  jsep?: { type: "offer" | "answer"; sdp: string }
  type?: string
  receiving?: boolean
  info?: Record<string, unknown>
}

export class JanusSession extends EventEmitter {
  sessionId = 0
  handleId = 0
  private readonly abort = new AbortController()
  private stopped = false
  private heartbeat?: NodeJS.Timeout
  constructor(
    private readonly base: string,
    private readonly adminBase: string,
    private readonly secret: string
  ) {
    super()
  }
  private async post(
    base: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<JanusEvent> {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: randomUUID(), ...body }),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]),
    })
    if (!response.ok)
      throw new GatewayError("JANUS_UNAVAILABLE", "Janus request failed", 502)
    const event = (await response.json()) as JanusEvent
    if (event.janus === "error")
      throw new GatewayError(
        "JANUS_ERROR",
        event.error?.reason ?? "Janus error",
        502
      )
    return event
  }
  async open(opaqueId?: string): Promise<void> {
    const session = await this.post(this.base, "", {
      janus: "create",
      apisecret: this.secret,
    })
    if (!session.data?.id) throw new Error("Missing Janus session id")
    this.sessionId = session.data.id
    const handle = await this.post(this.base, `/${this.sessionId}`, {
      janus: "attach",
      plugin: "janus.plugin.sip",
      apisecret: this.secret,
      opaque_id: opaqueId,
    })
    if (!handle.data?.id) throw new Error("Missing Janus handle id")
    this.handleId = handle.data.id
    this.heartbeat = setInterval(() => {
      void this.post(this.base, `/${this.sessionId}`, {
        janus: "keepalive",
        apisecret: this.secret,
      }).catch(() => {
        if (!this.stopped)
          this.emit("failure", new Error("Janus keepalive failed"))
      })
    }, 20000)
    void this.poll().catch((error) => {
      if (!this.stopped) this.emit("failure", error)
    })
  }
  private async poll(): Promise<void> {
    while (!this.stopped) {
      const url = new URL(`${this.base}/${this.sessionId}`)
      url.searchParams.set("rid", Date.now().toString())
      url.searchParams.set("maxev", "10")
      url.searchParams.set("apisecret", this.secret)
      const response = await fetch(url, {
        signal: AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(40000),
        ]),
      })
      if (!response.ok) throw new Error("Janus event poll failed")
      const events = (await response.json()) as JanusEvent | JanusEvent[]
      for (const event of Array.isArray(events) ? events : [events]) {
        if (event.janus === "timeout" || event.janus === "error")
          throw new Error("Janus session expired")
        this.emit("event", event)
      }
    }
  }
  async message(
    body: Record<string, unknown>,
    jsep?: JanusEvent["jsep"]
  ): Promise<void> {
    const result = await this.post(
      this.base,
      `/${this.sessionId}/${this.handleId}`,
      {
        janus: "message",
        apisecret: this.secret,
        body,
        ...(jsep ? { jsep: { ...jsep, trickle: false } } : {}),
      }
    )
    if (result.janus !== "ack") this.emit("event", result)
  }
  async info(): Promise<Record<string, unknown>> {
    const result = await this.post(
      this.adminBase,
      `/${this.sessionId}/${this.handleId}`,
      { janus: "handle_info", admin_secret: this.secret }
    )
    if (!result.info) throw new Error("Missing Janus handle info")
    return result.info
  }
  waitFor(
    predicate: (event: JanusEvent) => boolean,
    timeout = 25000
  ): Promise<JanusEvent> {
    return new Promise((resolve, reject) => {
      const done = (error?: Error, value?: JanusEvent) => {
        clearTimeout(timer)
        this.off("event", receive)
        this.off("failure", failed)
        if (error) reject(error)
        else resolve(value!)
      }
      const failed = (error: Error) => done(error)
      const receive = (event: JanusEvent) => {
        const data = event.plugindata?.data
        if (
          data?.error ||
          data?.result?.event === "registration_failed" ||
          data?.result?.event === "hangup" ||
          event.janus === "hangup"
        )
          done(
            new GatewayError(
              "SIP_ERROR",
              data?.error ?? data?.result?.reason ?? "SIP call ended",
              502
            )
          )
        else if (predicate(event)) done(undefined, event)
      }
      const timer = setTimeout(
        () =>
          done(
            new GatewayError(
              "GATEWAY_TIMEOUT",
              "Timed out waiting for Janus",
              504
            )
          ),
        timeout
      )
      this.on("event", receive)
      this.on("failure", failed)
    })
  }
  async close(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.heartbeat)
    // Resolve any pending waiter before aborting the long poll.
    this.emit("failure", new Error("Session closed"))
    if (this.sessionId) {
      await this.post(this.base, `/${this.sessionId}`, {
        janus: "destroy",
        apisecret: this.secret,
      }).catch(() => undefined)
    }
    this.abort.abort()
  }
}
