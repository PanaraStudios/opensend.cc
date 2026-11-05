import { stream } from "convex-helpers/server/stream"
import { v } from "convex/values"
import { mutation } from "./_generated/server"
import { api } from "./_generated/api"
import schema from "./schema"

const tables = [
  "oauthFlow",
  "oauthRate",
  "oauthUse",
  "ssoProof",
  "verification",
] as const
/** Creation-index scans also cover legacy rows while expiry indexes backfill. */
export const prune = mutation({
  args: {
    table: v.optional(v.union(...tables.map((t) => v.literal(t)))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { table = "oauthFlow", cursor }): Promise<null> => {
    const page = await stream(ctx.db, schema)
      .query(table)
      .withIndex("by_creation_time")
      .paginate({
        cursor: cursor ?? null,
        numItems: 100,
        maximumRowsRead: 100,
        maximumBytesRead: 2 * 1024 * 1024,
      })
    const now = Date.now()
    for (const row of page.page) {
      let expired = false
      if ("sessionId" in row) {
        const id = ctx.db.normalizeId("session", row.sessionId)
        const session = id ? await ctx.db.get("session", id) : null
        expired = !session || session.expiresAt <= now
      } else if ("grantId" in row) {
        if (row.expiresAt !== undefined) expired = row.expiresAt <= now
        else {
          const split = row.key.indexOf(":")
          const kind = row.key.slice(0, split)
          const hash = row.key.slice(split + 1)
          const token =
            kind === "code"
              ? await ctx.db
                  .query("verification")
                  .withIndex("identifier", (q) => q.eq("identifier", hash))
                  .first()
              : await ctx.db
                  .query("oauthRefreshToken")
                  .withIndex("token", (q) => q.eq("token", hash))
                  .first()
          expired = !token || token.expiresAt <= now
        }
      } else if ("start" in row)
        expired = (row.expiresAt ?? row.start + 3_600_000) <= now
      else if ("browserHash" in row)
        expired = row._creationTime <= now - 3_600_000
      else expired = row.expiresAt <= now
      if (expired) await ctx.db.delete(row._id)
    }
    const next = tables[tables.indexOf(table) + 1]
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, api.retention.prune, {
        table,
        cursor: page.continueCursor,
      })
    else if (next)
      await ctx.scheduler.runAfter(0, api.retention.prune, { table: next })
    return null
  },
})
