import { v } from "convex/values"
import { mutation, type MutationCtx, type QueryCtx } from "../_generated/server"
import { components } from "../_generated/api"
import { requireTeam, sessionId } from "../access"
import { deleteFile, retainFile } from "./files"
import { fileUrl } from "./urls"

export async function clearAsset(ctx: MutationCtx, organizationId: string) {
  const row = await ctx.db
    .query("teamAssets")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .unique()
  if (row) {
    await deleteFile(ctx, row)
    await ctx.db.delete("teamAssets", row._id)
  }
}
export const set = mutation({
  args: { organizationId: v.string(), fileId: v.id("storedFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "admin")
    const file = await retainFile(
      ctx,
      args.fileId,
      args.organizationId,
      "asset"
    )
    if (
      file.size > 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.contentType
      )
    )
      throw new Error("Upload an image up to 1 MB")
    await clearAsset(ctx, args.organizationId)
    await ctx.runMutation(components.betterAuth.teams.setAvatar, {
      organizationId: args.organizationId,
      sessionId: await sessionId(ctx),
    })
    await ctx.db.insert("teamAssets", args)
    return null
  },
})
export async function withAssets<T extends { id: string; avatar?: string }>(
  ctx: QueryCtx,
  teams: T[]
): Promise<T[]> {
  return Promise.all(
    teams.map(async (team) => {
      const asset = await ctx.db
        .query("teamAssets")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", team.id))
        .unique()
      return asset
        ? {
            ...team,
            avatar:
              (await fileUrl(ctx, asset, { disposition: "inline" })) ??
              undefined,
          }
        : team
    })
  )
}
