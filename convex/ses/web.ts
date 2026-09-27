/* Runtime-neutral helpers: the HTTP routes run in the default runtime and the
   actions that call them back run in Node, so both import from here. */
export class BodyTooLarge extends Error {
  constructor() {
    super("SNS body too large")
  }
}
/** Reads a body of at most `limit` bytes. A longer one throws, or with
    `truncate` is cut to its first `limit` bytes. */
export async function limitedBody(
  response: Request | Response,
  limit: number,
  { truncate = false } = {}
) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let size = 0
  let body = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        if (!truncate) throw new BodyTooLarge()
        return (
          body +
          decoder.decode(value.subarray(0, limit - size + value.byteLength))
        )
      }
      body += decoder.decode(value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    await reader.cancel()
  }
}
/** Proves a callback URL reaches this deployment without revealing the secret. */
export async function setupProof(challenge: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.BETTER_AUTH_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`opensend:setup-proof:${challenge}`)
  )
  return Array.from(new Uint8Array(signed), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}
