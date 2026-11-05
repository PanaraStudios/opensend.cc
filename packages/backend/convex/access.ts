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
export const findMetaApp = (ctx: QueryCtx | MutationCtx) =>
  ctx.db
    .query("metaApps")
    .withIndex("by_key", (q) => q.eq("key", "metaApp"))
    .unique()
export const metaAppReady = (
  app: Pick<Doc<"metaApps">, "verifiedAt" | "webhookSubscribedAt"> | null
) => !!app?.verifiedAt && !!app.webhookSubscribedAt
/** One capability check for dashboard state and backend guards. Legacy
 * installations have no explicit selection and keep connected channels. */
export async function instanceChannels(ctx: QueryCtx | MutationCtx) {
  const installation = await findInstallation(ctx)
  const app = await findMetaApp(ctx)
  return {
    email: emailConfigured(installation),
    meta:
      (installation?.channels?.meta ?? true) &&
      !installation?.metaDeferredAt &&
      metaAppReady(app),
  }
}
export async function requireMetaConfigured(ctx: QueryCtx | MutationCtx) {
  if (!(await instanceChannels(ctx)).meta)
    throw new ConvexError({
      statusCode: 403,
      name: "channel_not_configured",
      message: "Meta messaging is not set up on this instance",
    })
  return (await findMetaApp(ctx))!
}
/** Email capability is separate from installation setup and Meta channels. */
export const emailConfigured = (
  installation: Pick<
    Doc<"installation">,
    "accountId" | "credentialKind" | "channels" | "emailDeferredAt"
  > | null
) =>
  !!installation?.accountId &&
  !!installation.credentialKind &&
  !installation.emailDeferredAt &&
  (installation.channels?.email ?? true)

export async function requireEmailConfigured(ctx: QueryCtx | MutationCtx) {
  const installation = await findInstallation(ctx)
  if (!emailConfigured(installation))
    throw new ConvexError({
      statusCode: 403,
      name: "email_not_configured",
      message: "Email sending is not set up on this instance",
    })
  return installation!
}

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
/** A team has at most one tenant per region. */
export const findTenant = (
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  region: Doc<"sesTenants">["region"]
) =>
  ctx.db
    .query("sesTenants")
    .withIndex("by_organizationId_and_region", (q) =>
      q.eq("organizationId", organizationId).eq("region", region)
    )
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
/** Team roles follow Resend: every member reads and writes the product
    (domains, keys, emails, audience…); only admins (stored as `owner`)
    manage members, invitations, SSO and the team itself. */
export type TeamAccess = "read" | "write" | "admin"
export async function requireTeam(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  organizationId: string,
  access: TeamAccess = "read"
) {
  await ctx.runQuery(components.betterAuth.policy.authorizeTeam, {
    sessionId: await sessionId(ctx),
    organizationId,
    owner: access === "admin",
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
