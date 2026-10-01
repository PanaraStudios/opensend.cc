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
  options: { raw: true; truncate?: false }
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
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = limit - size
      if (value.byteLength > remaining && !truncate) throw new BodyTooLarge()
      const chunk = value.subarray(0, remaining)
      chunks.push(chunk)
      size += chunk.byteLength
      if (value.byteLength > remaining) break
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return raw ? bytes : new TextDecoder().decode(bytes)
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
