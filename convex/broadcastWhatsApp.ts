import { primaryContactIdentity } from "./audience"
import { contactChannelIdentityValue } from "./contacts"
import { ConvexError, v, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  action,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import { audience, recipientPage } from "./broadcasts"
import { findTopicChoice } from "./audience"
import { effectiveTopicSubscription } from "../lib/dashboard/contacts"
import {
  resolveVariables,
  variableSourcesError,
  type VariableSource,
} from "../lib/meta/variables"
import {
  createChannelMessage,
  resolveChannelAccount,
} from "./channels/messages"
import { findWhatsAppIdentity } from "./channels/identity"
import { matchesSearch } from "./lists"
import {
  resolveWhatsAppTemplate,
  whatsappSendComponents,
} from "./whatsapp/templates"
import { resolvedTemplateValue } from "./tables/templates"
import { skipReasonValue } from "./tables/broadcasts"
import { channelMessageStatusValue } from "./tables/channels"
import { teamTemplate, approvedTemplateOptions } from "./templates"
import { insertRow } from "./counts"

export async function resolveWhatsAppSend(
  ctx: QueryCtx,
  organizationId: string,
  config:
    | {
        accountId: string
        templateId: string
        variables: Record<string, VariableSource>
      }
    | undefined,
  options: { draft?: boolean } = {}
) {
  if (!config)
    throw new ConvexError("Select a sending number and an approved template")
  const error = variableSourcesError(config.variables)
  if (error) throw new ConvexError(error)
  if (options.draft) {
    const accountId = ctx.db.normalizeId("channelAccounts", config.accountId)
    const account = accountId
      ? await ctx.db.get("channelAccounts", accountId)
      : null
    const template = await teamTemplate(
      ctx,
      organizationId,
      config.templateId,
      "whatsapp"
    )
    if (
      !account ||
      !template ||
      account.organizationId !== organizationId ||
      account.channel !== "whatsapp" ||
      account.wabaId !== template.whatsapp?.wabaId
    )
      throw new ConvexError(
        "Choose a WhatsApp template from the sending number’s WABA"
      )
    return null
  }
  const account = await resolveChannelAccount(
    ctx,
    organizationId,
    config.accountId,
    "whatsapp"
  )
  const template = await resolveWhatsAppTemplate(ctx, organizationId, {
    id: config.templateId,
    wabaId: account.wabaId,
  })
  if (template.variables.some((key) => config.variables[key] === undefined))
    throw new ConvexError("Map every template variable before sending")
  return { account, template }
}

/** Use the send pipeline's account rule for both sends and picker options. */
async function sendableAccount(ctx: QueryCtx, row: Doc<"channelAccounts">) {
  try {
    await resolveChannelAccount(ctx, row.organizationId, row._id, "whatsapp")
    return true
  } catch {
    return false
  }
}

export async function recipientSkipReason(
  ctx: QueryCtx,
  row: Pick<Doc<"broadcasts">, "organizationId">,
  contact: Doc<"contacts"> | null,
  topic: Doc<"topics"> | null,
  template?: Infer<typeof resolvedTemplateValue>,
  variables: Record<string, VariableSource> = {}
): Promise<Infer<typeof skipReasonValue> | null> {
  if (!contact || contact.organizationId !== row.organizationId)
    return "contact_deleted"
  if (!contact.phone) return "no_phone"
  if (contact.unsubscribed) return "unsubscribed"
  if (
    topic &&
    effectiveTopicSubscription(
      (await findTopicChoice(ctx, contact._id, topic._id))?.subscription,
      topic
    ) !== "subscribed"
  )
    return "topic_opt_out"
  if (template?.category === "MARKETING") {
    const identity = await findWhatsAppIdentity(
      ctx,
      row.organizationId,
      contact.phone
    )
    if (identity?.marketingOptOut) return "marketing_opt_out"
  }
  if (template) {
    try {
      whatsappSendComponents(template, resolveVariables(variables, contact))
    } catch {
      return "missing_variables"
    }
  }
  return null
}

/** Ten recipients per transaction; delivery's per-number limiter does the pacing. */
export async function sendWhatsAppRecipient(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  contact: Doc<"contacts">,
  topic: Doc<"topics"> | null,
  target: NonNullable<Awaited<ReturnType<typeof resolveWhatsAppSend>>>
) {
  const previous = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_broadcastId_and_contactId", (q) =>
      q.eq("broadcastId", row._id).eq("contactId", contact._id)
    )
    .unique()
  if (previous) return
  const reason = await recipientSkipReason(
    ctx,
    row,
    contact,
    topic,
    target.template,
    row.whatsapp!.variables
  )
  const variables = resolveVariables(row.whatsapp!.variables, contact)
  const messageId = reason
    ? undefined
    : await createChannelMessage(
        ctx,
        {
          channel: "whatsapp",
          from: target.account._id,
          to: contact.phone!,
          body: {
            type: "template",
            template: { id: row.whatsapp!.templateId, variables },
          },
        },
        {
          organizationId: row.organizationId,
          source: "broadcast",
          broadcastId: row._id,
        }
      )
  await insertRow(ctx, "broadcastRecipients", {
    organizationId: row.organizationId,
    broadcastId: row._id,
    contactId: contact._id,
    email: contact.email ?? "",
    messageId,
    skipReason: reason ?? undefined,
    settled: !!reason,
    failed: false,
  })
}

const scope = { organizationId: v.string(), id: v.id("broadcasts") }
const estimateValue = v.object({
  recipients: v.number(),
  skipped: v.number(),
  noPhone: v.number(),
})
const reviewContextValue = v.object({
  row: schema.doc("broadcasts"),
  topic: v.union(schema.doc("topics"), v.null()),
  template: resolvedTemplateValue,
})
export const reviewContext = internalQuery({
  args: scope,
  returns: reviewContextValue,
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.organizationId !== organizationId ||
      row._id !== id ||
      row.channel !== "whatsapp"
    )
      throw new ConvexError("Broadcast not found")
    const target = (await resolveWhatsAppSend(
      ctx,
      organizationId,
      row.whatsapp
    ))!
    const { sendComponents: _send, ...template } = target.template
    void _send
    return { row, topic: await audience(ctx, row), template }
  },
})
export const reviewPage = internalQuery({
  args: {
    ...scope,
    cursor: v.union(v.string(), v.null()),
    context: v.optional(reviewContextValue),
  },
  returns: estimateValue.extend({ done: v.boolean(), cursor: v.string() }),
  handler: async (ctx, { organizationId, id, cursor, context }) => {
    await requireTeam(ctx, organizationId)
    const row = context?.row ?? (await ctx.db.get("broadcasts", id))
    if (
      !row ||
      row.organizationId !== organizationId ||
      row._id !== id ||
      row.channel !== "whatsapp"
    )
      throw new ConvexError("Broadcast not found")
    const template =
      context?.template ??
      (await resolveWhatsAppSend(ctx, organizationId, row.whatsapp))!.template
    const topic = context ? context.topic : await audience(ctx, row)
    const page = await recipientPage(
      ctx,
      row,
      cursor,
      undefined,
      100,
      false,
      topic
    )
    let recipients = 0,
      skipped = 0,
      noPhone = 0
    for (const contact of page.page) {
      const reason = await recipientSkipReason(
        ctx,
        row,
        contact,
        topic,
        template,
        row.whatsapp!.variables
      )
      if (reason) {
        skipped++
        if (reason === "no_phone") noPhone++
      } else recipients++
    }
    return {
      recipients,
      skipped,
      noPhone,
      done: page.isDone,
      cursor: page.continueCursor,
    }
  },
})
export const review = action({
  args: scope,
  returns: estimateValue,
  handler: async (
    ctx,
    args
  ): Promise<{ recipients: number; skipped: number; noPhone: number }> => {
    const context: Infer<typeof reviewContextValue> = await ctx.runQuery(
      internal.broadcastWhatsApp.reviewContext,
      args
    )
    const result = { recipients: 0, skipped: 0, noPhone: 0 }
    let cursor: string | null = null
    for (;;) {
      const page: {
        recipients: number
        skipped: number
        noPhone: number
        done: boolean
        cursor: string
      } = await ctx.runQuery(internal.broadcastWhatsApp.reviewPage, {
        ...args,
        cursor,
        context,
      })
      result.recipients += page.recipients
      result.skipped += page.skipped
      result.noPhone += page.noPhone
      if (page.done) return result
      cursor = page.cursor
    }
  },
})
export const recipients = query({
  args: { ...scope, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    schema.doc("broadcastRecipients").extend({
      phone: v.optional(v.string()),
      contact: v.union(
        v.null(),
        schema
          .doc("contacts")
          .extend({
            channelIdentity: v.union(v.null(), contactChannelIdentityValue),
          })
      ),
      messageStatus: v.optional(channelMessageStatusValue),
    })
  ),
  handler: async (ctx, { organizationId, id, paginationOpts }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    if (row?.organizationId !== organizationId)
      throw new ConvexError("Broadcast not found")
    const result = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_broadcastId_and_contactId", (q) => q.eq("broadcastId", id))
      .paginate(paginationOpts)
    const page = []
    for (const recipient of result.page) {
      const contact = await ctx.db.get("contacts", recipient.contactId)
      const message = recipient.messageId
        ? await ctx.db.get("channelMessages", recipient.messageId)
        : null
      page.push({
        contact:
          contact?.organizationId === organizationId
            ? {
                ...contact,
                channelIdentity: await primaryContactIdentity(ctx, contact),
              }
            : null,
        messageStatus:
          message?.organizationId === organizationId
            ? message.status
            : undefined,
        ...recipient,
        phone:
          contact?.organizationId === organizationId
            ? contact.phone
            : undefined,
      })
    }
    return { ...result, page }
  },
})

/** Compact, authorized campaign picker data, with the selected template's
 * published components rather than unsubmitted edits. */
export const options = query({
  args: {
    organizationId: v.string(),
    accountId: v.optional(v.string()),
    templateId: v.optional(v.string()),
    accountSearch: v.optional(v.string()),
    templateSearch: v.optional(v.string()),
  },
  returns: v.object({
    accounts: v.array(
      v.object({
        id: v.id("channelAccounts"),
        name: v.string(),
        wabaId: v.optional(v.string()),
      })
    ),
    templates: v.array(v.object({ id: v.id("templates"), name: v.string() })),
    selected: v.union(v.null(), resolvedTemplateValue),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const rows = await ctx.db
      .query("channelAccounts")
      .withIndex("by_organizationId_and_channel_and_disconnectedAt", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("channel", "whatsapp")
          .eq("disconnectedAt", undefined)
      )
      .take(200)
    const active = []
    for (const row of rows) {
      if (await sendableAccount(ctx, row)) active.push(row)
    }
    const account = active.find((row) => row._id === args.accountId)
    const templates = account?.wabaId
      ? await approvedTemplateOptions(ctx, args.organizationId, {
          wabaId: account.wabaId,
          approvedOnly: true,
          search: args.templateSearch,
          selectedId: args.templateId,
        })
      : []
    let selected = null
    if (account && templates.some((row) => row._id === args.templateId)) {
      const resolved = await resolveWhatsAppTemplate(ctx, args.organizationId, {
        id: args.templateId,
        wabaId: account.wabaId,
      })
      const { sendComponents: _send, ...value } = resolved
      void _send
      selected = value
    }
    const accountMatches = matchesSearch(args.accountSearch)
    return {
      accounts: active
        .filter(
          (row) =>
            row._id === args.accountId ||
            accountMatches(row.displayName, row.handle)
        )
        .map((row) => ({
          id: row._id,
          name: `${row.displayName} (${row.handle})`,
          wabaId: row.wabaId,
        })),
      templates: templates.map((row) => ({ id: row._id, name: row.name })),
      selected,
    }
  },
})
export const sampleContact = query({
  args: {
    ...scope,
    segmentId: v.optional(v.union(v.id("segments"), v.null())),
    topicId: v.optional(v.union(v.id("topics"), v.null())),
  },
  returns: v.union(v.null(), schema.doc("contacts")),
  handler: async (ctx, { organizationId, id, segmentId, topicId }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    if (!row || row.organizationId !== organizationId) return null
    const page = await recipientPage(
      ctx,
      {
        ...row,
        ...(segmentId !== undefined ? { segmentId } : {}),
        ...(topicId !== undefined ? { topicId } : {}),
      },
      null,
      undefined,
      10
    )
    return page.page.find((contact) => contact.phone) ?? null
  },
})
