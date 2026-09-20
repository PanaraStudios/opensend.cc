import { ConvexError } from "convex/values"
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server"
/** Identity and session ID are taken only from a verified Convex JWT. */
export async function sessionId(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity || typeof identity.sessionId !== "string")
    throw new ConvexError("Sign in to continue")
  return identity.sessionId
}
