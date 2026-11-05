import type { MutationCtx } from "../_generated/server"
import { apiError, type Caller } from "./caller"

/** Fence stale actions before any writes; commit the wire response with the resource. */
export async function idempotent<T>(
  ctx: MutationCtx,
  caller: Caller,
  work: () => Promise<T>,
  response: (result: T) => { body: unknown; status?: number }
): Promise<T> {
  const id = caller.idempotencyId
  if (id) {
    const reservation = await ctx.db.get("apiIdempotency", id)
    if (
      !reservation ||
      reservation.organizationId !== caller.organizationId ||
      reservation.expiresAt <= Date.now() ||
      reservation.response
    )
      throw apiError(
        409,
        "concurrent_idempotent_requests",
        "Another request with the same idempotency key is currently in progress. As this request is still being processed, retry it later."
      )
  }
  const result = await work()
  if (id) {
    const reply = response(result)
    await ctx.db.patch("apiIdempotency", id, {
      response: {
        status: reply.status ?? 200,
        body: JSON.stringify(reply.body),
      },
    })
  }
  return result
}
