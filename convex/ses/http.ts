import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
export const health = httpAction(async (_ctx, request) => {
  const challenge = new URL(request.url).searchParams.get("challenge") ?? ""
  if (challenge.length > 100) return new Response(null, { status: 400 })
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
  const proof = Array.from(new Uint8Array(signed), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
  return Response.json(
    { challenge, proof },
    { headers: { "Cache-Control": "no-store" } }
  )
})
export const receive = httpAction(async (ctx, request) => {
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 400 })
  let size = 0
  let body = ""
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 300000) return new Response(null, { status: 413 })
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    await ctx.runAction(internal.ses.events.receive, { body })
    return new Response(null, { status: 204 })
  } catch {
    // Keep legitimate provider/network failures retryable. Never echo signed data.
    return new Response("SNS event was not accepted", { status: 503 })
  } finally {
    await reader.cancel()
  }
})
