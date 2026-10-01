import { ConvexError, v } from "convex/values"
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
import { resolveVariables, variableSourcesError } from "../lib/meta/variables"
import {
  createChannelMessage,
  resolveWhatsAppAccount,
} from "./channels/messages"
import { selectedOption } from "./lists"
import { searchOptions } from "./lists"
import { includeSelected } from "../lib/dashboard/options"
import {
  resolvedTemplateValue,
  resolveWhatsAppTemplate,
} from "./whatsapp/templates"
import { insertRow } from "./counts"

export async function campaignTemplate(
  ctx: QueryCtx,
  organizationId: string,
  config: Doc<"broadcasts">["whatsapp"]
) {
  if (!config)
    throw new ConvexError("Select a sending number and an approved template")
  const error = variableSourcesError(config.variables)
  if (error) throw new ConvexError(error)
  const account = await resolveWhatsAppAccount(
    ctx,
    organizationId,
    config.accountId
  )
  const template = await resolveWhatsAppTemplate(ctx, organizationId, {
    id: config.templateId,
    wabaId: account.wabaId,
  })
  if (template.variables.some((key) => config.variables[key] === undefined))
    throw new ConvexError("Map every template variable before sending")
  return { account, template }
}

export async function whatsappSkipReason(
  ctx: QueryCtx,
  row: Pick<Doc<"broadcasts">, "organizationId">,
  contact: Doc<"contacts">,
  topic: Doc<"topics"> | null,
  account: Doc<"channelAccounts">,
  category: string
) {
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
  if (category === "MARKETING") {
    const identity = await ctx.db
      .query("channelContacts")
      .withIndex(
        "by_organizationId_and_channel_and_scopeId_and_externalId",
        (q) =>
          q
            .eq("organizationId", row.organizationId)
            .eq("channel", "whatsapp")
            .eq("scopeId", "whatsapp")
            .eq("externalId", contact.phone!.slice(1))
      )
      .unique()
    if (
      identity?.organizationId === row.organizationId &&
      identity.marketingOptOut
    )
      return "marketing_opt_out"
  }
  return null
}

/** Ten recipients per transaction; delivery's per-number limiter does the pacing. */
export async function sendWhatsAppRecipient(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  contact: Doc<"contacts">,
  topic: Doc<"topics"> | null,
  target: Awaited<ReturnType<typeof campaignTemplate>>
) {
  const previous = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_broadcastId_and_contactId", (q) =>
      q.eq("broadcastId", row._id).eq("contactId", contact._id)
    )
    .unique()
  if (previous) return
  let reason = await whatsappSkipReason(
    ctx,
    row,
    contact,
    topic,
    target.account,
    target.template.category
  )
  const variables = resolveVariables(row.whatsapp!.variables, contact)
  if (!reason) {
    try {
      target.template.sendComponents(variables)
    } catch {
      reason = "missing_variables"
    }
  }
  const messageId = reason
    ? undefined
    : await createChannelMessage(
        ctx,
        {
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
export const reviewPage = internalQuery({
  args: { ...scope, cursor: v.union(v.string(), v.null()) },
  returns: estimateValue.extend({ done: v.boolean(), cursor: v.string() }),
  handler: async (ctx, { organizationId, id, cursor }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.organizationId !== organizationId ||
      row.channel !== "whatsapp"
    )
      throw new ConvexError("Broadcast not found")
    const target = await campaignTemplate(ctx, organizationId, row.whatsapp)
    const topic = await audience(ctx, row)
    const page = await recipientPage(ctx, row, cursor)
    let recipients = 0,
      skipped = 0,
      noPhone = 0
    for (const contact of page.page) {
      let reason = await whatsappSkipReason(
        ctx,
        row,
        contact,
        topic,
        target.account,
        target.template.category
      )
      if (!reason) {
        try {
          target.template.sendComponents(
            resolveVariables(row.whatsapp!.variables, contact)
          )
        } catch {
          reason = "missing_variables"
        }
      }
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
    schema.doc("broadcastRecipients").extend({ phone: v.optional(v.string()) })
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
      page.push({
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
      const connection = await ctx.db.get("metaConnections", row.connectionId)
      if (
        row.status === "active" &&
        row.registeredAt !== undefined &&
        connection?.status === "active" &&
        connection.organizationId === args.organizationId
      )
        active.push(row)
    }
    const account = active.find((row) => row._id === args.accountId)
    const selectedRow = await selectedOption(
      ctx,
      "templates",
      args.organizationId,
      args.templateId
    )
    const templateRows = args.templateSearch?.trim()
      ? await searchOptions(
          ctx,
          "templates",
          args.organizationId,
          args.templateSearch
        )
      : await ctx.db
          .query("templates")
          .withIndex("by_organizationId_and_channel", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("channel", "whatsapp")
          )
          .order("desc")
          .take(100)
    const templates = includeSelected(
      templateRows,
      selectedRow,
      (row) => row._id
    ).filter(
      (row) =>
        row.channel === "whatsapp" &&
        row.whatsapp?.wabaId === account?.wabaId &&
        row.whatsapp?.metaStatus === "APPROVED" &&
        row.status === "published"
    )
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
    const needle = args.accountSearch?.trim().toLowerCase() ?? ""
    return {
      accounts: active
        .filter(
          (row) =>
            row._id === args.accountId ||
            `${row.displayName} ${row.handle}`.toLowerCase().includes(needle)
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
