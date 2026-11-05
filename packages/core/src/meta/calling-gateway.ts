/** Default-runtime callback verifier. Nonce consumption belongs in a durable mutation. */
export async function verifyGatewayHmac(
  secret: string,
  request: Request,
  raw: Uint8Array<ArrayBuffer>,
  now = Date.now()
) {
  const timestamp = request.headers.get("x-call-gateway-timestamp") ?? "",
    nonce = request.headers.get("x-call-gateway-nonce") ?? "",
    signature = request.headers.get("x-call-gateway-signature") ?? ""
  if (
    secret.length < 32 ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 60 ||
    !/^[a-zA-Z0-9-]{16,128}$/.test(nonce) ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    return null
  const url = new URL(request.url)
  if (url.search) return null
  const hex = (value: ArrayBuffer) =>
    Array.from(new Uint8Array(value), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("")
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", raw))
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  const canonical = `${timestamp}\n${nonce}\n${request.method.toUpperCase()}\n${url.pathname}\n${bodyHash}`
  const bytes = new Uint8Array(
    signature
      .slice(7)
      .match(/../g)!
      .map((pair) => parseInt(pair, 16))
  )
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(canonical)
    ))
  )
    return null
  return { nonce, expiresAt: (Number(timestamp) + 61) * 1000 }
}
