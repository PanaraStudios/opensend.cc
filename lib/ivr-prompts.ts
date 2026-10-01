export interface PromptRenderer {
  readonly name: string
  render(
    text: string,
    language: string,
    voice?: string
  ): Promise<{ audio: Blob } | { status: "pending_render" }>
}
/** No key-free TTS module is built in the pinned 1.11.3 calling image. */
export class PendingPromptRenderer implements PromptRenderer {
  readonly name = "pending-sarvam-bulbul-v3"
  async render(): Promise<{ status: "pending_render" }> {
    return { status: "pending_render" }
  }
}
export const IVR_RENDERER = new PendingPromptRenderer().name
const encode = new TextEncoder()
export async function promptHash(
  text: string,
  language: string,
  voice: string | undefined,
  renderer: string
) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    encode.encode(JSON.stringify([text, language, voice ?? null, renderer]))
  )
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}
async function key(secret: string, usage: KeyUsage[]) {
  if (secret.length < 32) throw new Error("Prompt signing is not configured")
  return crypto.subtle.importKey(
    "raw",
    encode.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  )
}
const content = (callId: string, fileId: string, expires: number) =>
  encode.encode(JSON.stringify(["ivr-prompt-v1", callId, fileId, expires]))
export async function signPrompt(
  secret: string,
  callId: string,
  fileId: string,
  expires: number
) {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await key(secret, ["sign"]),
    content(callId, fileId, expires)
  )
  return Array.from(new Uint8Array(mac), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}
export async function verifyPrompt(
  secret: string,
  callId: string,
  fileId: string,
  expires: number,
  signature: string,
  now = Date.now()
) {
  if (
    !Number.isSafeInteger(expires) ||
    expires <= now ||
    expires > now + 15 * 60_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false
  const bytes = Uint8Array.from(signature.match(/../g)!, (b) => parseInt(b, 16))
  return crypto.subtle.verify(
    "HMAC",
    await key(secret, ["verify"]),
    bytes,
    content(callId, fileId, expires)
  )
}
