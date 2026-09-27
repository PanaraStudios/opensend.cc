import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { BodyTooLarge, limitedBody, setupProof } from "./web"
export const health = httpAction(async (_ctx, request) => {
  const challenge = new URL(request.url).searchParams.get("challenge") ?? ""
  if (challenge.length > 100) return new Response(null, { status: 400 })
  return Response.json(
    { challenge, proof: await setupProof(challenge) },
    { headers: { "Cache-Control": "no-store" } }
  )
})
export const receive = httpAction(async (ctx, request) => {
  if (!request.body) return new Response(null, { status: 400 })
  try {
    const body = await limitedBody(request, 300000)
    await ctx.runAction(internal.ses.events.receive, { body })
    return new Response(null, { status: 204 })
  } catch (e) {
    if (e instanceof BodyTooLarge) return new Response(null, { status: 413 })
    // Keep legitimate provider/network failures retryable. Never echo signed data.
    return new Response("SNS event was not accepted", { status: 503 })
  }
})
