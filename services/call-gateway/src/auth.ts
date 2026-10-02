import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { GatewayError } from "./errors.js"

export const AUTH_WINDOW_SECONDS = 60
const HEADER = "x-call-gateway-"

export function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000).toString(),
  nonce: string = randomUUID()
): Record<string, string> {
  const digest = createHash("sha256").update(body).digest("hex")
  const signature = createHmac("sha256", secret)
    .update(
      `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${digest}`
    )
    .digest("hex")
  return {
    [`${HEADER}timestamp`]: timestamp,
    [`${HEADER}nonce`]: nonce,
    [`${HEADER}signature`]: `sha256=${signature}`,
  }
}

/** One verifier per process; callbacks must use a NEW nonce for every retry. */
export class HmacVerifier {
  private readonly seen = new Map<string, number>()
  constructor(
    private readonly secret: string,
    private readonly clock = () => Date.now()
  ) {
    if (secret.length < 32)
      throw new Error("CALL_GATEWAY_SECRET must contain at least 32 characters")
  }
  verify(
    method: string,
    path: string,
    body: string,
    headers: Record<string, string | string[] | undefined>
  ) {
    const timestamp = headers[`${HEADER}timestamp`]
    const nonce = headers[`${HEADER}nonce`]
    const signature = headers[`${HEADER}signature`]
    const now = Math.floor(this.clock() / 1000)
    const unauthorized = () =>
      new GatewayError("UNAUTHORIZED", "Invalid request signature", 401)
    if (
      typeof timestamp !== "string" ||
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp)) > AUTH_WINDOW_SECONDS ||
      typeof nonce !== "string" ||
      !/^[a-zA-Z0-9-]{16,128}$/.test(nonce) ||
      typeof signature !== "string" ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    )
      throw unauthorized()
    const expected = signRequest(
      this.secret,
      method,
      path,
      body,
      timestamp,
      nonce
    )[`${HEADER}signature`]
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw unauthorized()
    for (const [key, expiry] of this.seen)
      if (expiry < now) this.seen.delete(key)
    if (this.seen.has(nonce)) throw unauthorized()
    if (this.seen.size >= 10000)
      throw new GatewayError("AUTH_CAPACITY", "Too many requests", 429)
    this.seen.set(nonce, Number(timestamp) + AUTH_WINDOW_SECONDS)
  }
}
