import { ConvexError } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { CHANNELS, type PageChannel } from "../lib/channels"
import { variableSourcesError, resolveVariables } from "../lib/meta/variables"
import { pageMessageContent } from "../lib/meta/payloads"
import { resolveChannelAccount } from "./channels/messages"
import {
  localTemplateDefinition,
  resolveLocalTemplate,
} from "./channels/templates"
import { findPageIdentity } from "./channels/identity"
import { teamTemplate } from "./templates"

export async function resolvePageBroadcast(
  ctx: QueryCtx,
  organizationId: string,
  channel: PageChannel,
  config: Doc<"broadcasts">["messaging"],
  options: { draft?: boolean } = {}
) {
  if (!config)
    throw new ConvexError(
      `Select a connected ${CHANNELS[channel].accountNoun.toLowerCase()} and a published template`
    )
  const error = variableSourcesError(config.variables)
  if (error) throw new ConvexError(error)
  const account = await resolveChannelAccount(
    ctx,
    organizationId,
    config.accountId,
    channel
  )
  if (options.draft) {
    if (!(await teamTemplate(ctx, organizationId, config.templateId, channel)))
      throw new ConvexError("Choose a template for this channel")
    return { account }
  }
  const { published } = await localTemplateDefinition(
    ctx,
    organizationId,
    channel,
    config.templateId
  )
  if (
    published.variables.some(
      (variable) =>
        config.variables[variable.key] === undefined &&
        variable.fallback === undefined
    )
  )
    throw new ConvexError("Map every template variable before sending")
  return { account }
}

/** The same account-scoped identity and standard window rules as automations. */
export async function pageBroadcastRecipient(
  ctx: QueryCtx,
  row: Doc<"broadcasts">,
  contact: Doc<"contacts">,
  account: Doc<"channelAccounts">,
  now: number
) {
  const identity = await findPageIdentity(ctx, account, contact._id)
  if (!identity) return { reason: "no_channel_identity" as const }
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_accountId_and_channelContactId", (q) =>
      q.eq("accountId", account._id).eq("channelContactId", identity._id)
    )
    .unique()
  if ((conversation?.windowExpiresAt ?? 0) <= now)
    return { reason: "window_closed" as const }
  try {
    const template = await resolveLocalTemplate(
      ctx,
      row.organizationId,
      account.channel,
      {
        id: row.messaging!.templateId,
        variables: resolveVariables(row.messaging!.variables, contact),
      }
    )
    pageMessageContent(template.body, row.channel as PageChannel)
  } catch {
    return { reason: "missing_variables" as const }
  }
  return { to: identity.externalId, reason: null }
}
