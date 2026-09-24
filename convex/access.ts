import { ConvexError } from "convex/values"
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server"
import { components } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
/** The installation is a singleton; every caller reads it through here.
    It lives beside the access checks so modules below installation.ts can use
    it without importing back into it. */
export const findInstallation = (ctx: QueryCtx | MutationCtx) =>
  ctx.db
    .query("installation")
    .withIndex("by_key", (q) => q.eq("key", "installation"))
    .unique()
export async function requireConnection(ctx: QueryCtx | MutationCtx) {
  const installation = await findInstallation(ctx)
  if (!installation?.accountId || !installation.credentialKind)
    throw new ConvexError("Connect AWS first")
  return installation
}
export const findRegion = (
  ctx: QueryCtx | MutationCtx,
  region: Doc<"sesRegions">["region"]
) =>
  ctx.db
    .query("sesRegions")
    .withIndex("by_region", (q) => q.eq("region", region))
    .unique()
/** At most one row per supported region, so the list is always small. */
export const listRegions = (ctx: QueryCtx | MutationCtx) =>
  ctx.db.query("sesRegions").withIndex("by_region").take(20)
export const allRegionsReady = (regions: Doc<"sesRegions">[]) =>
  regions.length > 0 && regions.every((region) => region.phase === "ready")
export const defaultCallbackOrigin = () =>
  process.env.SES_CALLBACK_ORIGIN || process.env.CONVEX_SITE_URL || ""
/** Identity and session ID are taken only from a verified Convex JWT. */
export async function sessionId(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity || typeof identity.sessionId !== "string")
    throw new ConvexError("Sign in to continue")
  return identity.sessionId
}
export async function installationAccess(
  ctx: QueryCtx | MutationCtx | ActionCtx
) {
  return ctx.runQuery(components.betterAuth.policy.authorizeInstallation, {
    sessionId: await sessionId(ctx),
  })
}
export async function requireInstallationAdmin(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  message = "Only the installation administrator can configure AWS"
) {
  if (!(await installationAccess(ctx)).admin) throw new ConvexError(message)
}
export async function requireTeam(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  organizationId: string,
  write = false
) {
  await ctx.runQuery(components.betterAuth.policy.authorizeTeam, {
    sessionId: await sessionId(ctx),
    organizationId,
    write,
  })
}
export async function requireSetupComplete(ctx: QueryCtx | MutationCtx) {
  const access = await installationAccess(ctx)
  const installation = await findInstallation(ctx)
  if (!installation?.completedAt)
    throw new ConvexError(
      "Finish installation setup before managing teams or invitations"
    )
  return { access, installation }
}
