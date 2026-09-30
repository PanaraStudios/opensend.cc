import { ConvexError } from "convex/values"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/** Kept after erasure so delayed jobs cannot recreate a deleted team's data. */
export const retirement = (ctx: QueryCtx | MutationCtx, teamId: string) =>
  ctx.db
    .query("teamRetirements")
    .withIndex("by_teamId", (q) => q.eq("teamId", teamId))
    .unique()

export async function requireActiveTeam(
  ctx: QueryCtx | MutationCtx,
  teamId: string
) {
  if (await retirement(ctx, teamId)) throw new ConvexError("Team not found")
}
