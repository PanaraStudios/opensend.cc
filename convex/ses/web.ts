import { hmacHex } from "../../lib/tokens/signed"
/* Runtime-neutral helpers: the HTTP routes run in the default runtime and the
   actions that call them back run in Node, so both import from here. */
export class BodyTooLarge extends Error {
  constructor() {
    super("SNS body too large")
  }
}
/** Reads a body of at most `limit` bytes. A longer one throws, or with
    `truncate` is cut to its first `limit` bytes. */
export function limitedBody(
  response: Request | Response,
  limit: number,
  options: { raw: true; truncate?: boolean }
): Promise<Uint8Array<ArrayBuffer>>
export function limitedBody(
  response: Request | Response,
  limit: number,
  options?: { raw?: false; truncate?: boolean }
): Promise<string>
export async function limitedBody(
  response: Request | Response,
  limit: number,
  { truncate = false, raw = false }: { truncate?: boolean; raw?: boolean } = {}
) {
  const reader = response.body?.getReader()
  if (!reader) return raw ? new Uint8Array(0) : ""
  const decoder = new TextDecoder()
  let size = 0
  let body = ""
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        if (!truncate) throw new BodyTooLarge()
        if (raw) {
          chunks.push(value.subarray(0, limit - size + value.byteLength))
          const bytes = new Uint8Array(limit)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          return bytes
        }
        return (
          body +
          decoder.decode(value.subarray(0, limit - size + value.byteLength))
        )
      }
      if (raw) chunks.push(value)
      else body += decoder.decode(value, { stream: true })
    }
    if (raw) {
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return bytes
    }
    return body + decoder.decode()
  } finally {
    await reader.cancel()
  }
}
/** Proves a callback URL reaches this deployment without revealing the secret. */
export function setupProof(challenge: string) {
  return hmacHex(
    `opensend:setup-proof:${challenge}`,
    process.env.BETTER_AUTH_SECRET ?? ""
  )
}
