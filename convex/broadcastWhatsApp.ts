import {
  isPageChannel,
  rowChannel,
  BROADCAST_CAPABILITIES,
} from "../lib/channels"
import {
  resolvePageBroadcast,
  pageBroadcastRecipient,
} from "./broadcastMessaging"
import { primaryContactIdentity } from "./audience"
import { emailStatusValue } from "./tables/emails"
import { contactChannelIdentityValue } from "./contacts"
import {
  publicRecipientValue,
  publicRecipient,
  readPageDocuments,
  recipientMessageStatuses,
} from "./broadcastReadModel"
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
  normalizeVariableSource,
  variableSourcesError,
  type VariableSource,
} from "../lib/meta/variables"
import {
  createChannelMessage,
  reserveSends,
  resolveChannelAccount,
} from "./channels/messages"
import { retainStepMedia, stepMedia, type StepMedia } from "./storage/media"
import { toWaId } from "../lib/dashboard/phone"
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
import { templateMediaHeader, storedComponents } from "../lib/meta/templates"
import { deliveryFailureReason } from "../lib/meta/errors"

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
  const header = templateMediaHeader(storedComponents(template.components))
  const source = config.variables.header_media
  const media =
    source === undefined ? undefined : normalizeVariableSource(source)
  const emptyMedia =
    !media ||
    ("value" in media && !media.value.trim() && !media.fallback?.trim())
  if (header && !header.sampleFileId && emptyMedia)
    throw new ConvexError(
      `This template needs a header ${header.format.toLowerCase()}.`
    )
  if (
    template.variables.some(
      (key) => key !== "header_media" && config.variables[key] === undefined
    )
  )
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
  variables: Record<string, VariableSource> = {},
  requirePhone = true,
  /** The contact's WhatsApp identity when the caller has read it. */
  knownIdentity?: Doc<"channelContacts"> | null
): Promise<Infer<typeof skipReasonValue> | null> {
  if (!contact || contact.organizationId !== row.organizationId)
    return "contact_deleted"
  if (requirePhone && !contact.phone) return "no_phone"
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
    const identity =
      knownIdentity !== undefined
        ? knownIdentity
        : await findWhatsAppIdentity(ctx, row.organizationId, contact.phone!)
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

type MessagingTarget =
  | NonNullable<Awaited<ReturnType<typeof resolveWhatsAppSend>>>
  | Awaited<ReturnType<typeof resolvePageBroadcast>>

/** What one recipient will get: a skip reason, or the address to send to.
    Null when the recipient was already written (a retried or redone step). */
async function planRecipient(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  contact: Doc<"contacts">,
  topic: Doc<"topics"> | null,
  target: MessagingTarget
) {
  const previous = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_broadcastId_and_contactId", (q) =>
      q.eq("broadcastId", row._id).eq("contactId", contact._id)
    )
    .unique()
  if (previous) return null
  const channel = rowChannel(row)
  const config = row[BROADCAST_CAPABILITIES[channel].configKey!]!
  // Read once: for the marketing opt-out here and for the send's thread.
  const identity =
    !isPageChannel(channel) &&
    contact.phone &&
    contact.organizationId === row.organizationId
      ? {
          externalId: toWaId(contact.phone),
          identity: await findWhatsAppIdentity(
            ctx,
            row.organizationId,
            contact.phone
          ),
        }
      : undefined
  let reason = await recipientSkipReason(
    ctx,
    row,
    contact,
    topic,
    "template" in target ? target.template : undefined,
    config.variables,
    !isPageChannel(channel),
    identity?.identity
  )
  const pageRecipient =
    !reason && isPageChannel(channel)
      ? await pageBroadcastRecipient(
          ctx,
          row,
          contact,
          target.account,
          Date.now()
        )
      : null
  reason = reason ?? pageRecipient?.reason ?? null
  return {
    contact,
    config,
    identity,
    reason,
    to: pageRecipient?.to ?? contact.phone!,
  }
}

/** Writes a planned recipient: its queued message (unless skipped) and its
    recipient row, the idempotency key, in the same transaction. */
async function commitRecipient(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  plan: NonNullable<Awaited<ReturnType<typeof planRecipient>>>,
  target: MessagingTarget,
  step?: { readyAt?: number; media?: StepMedia }
) {
  const { contact, config, reason } = plan
  const variables = resolveVariables(config.variables, contact)
  const messageId = reason
    ? undefined
    : await createChannelMessage(
        ctx,
        {
          channel: target.account.channel,
          from: target.account._id,
          to: plan.to,
          body: {
            type: "template",
            template: { id: config.templateId, variables },
          },
        },
        {
          organizationId: row.organizationId,
          source: "broadcast",
          broadcastId: row._id,
          ...(step
            ? {
                prepared: {
                  account: target.account,
                  ...("template" in target
                    ? { template: target.template }
                    : {}),
                  readyAt: step.readyAt,
                  media: step.media,
                  identity: plan.identity,
                },
              }
            : {}),
        }
      )
  await insertRow(ctx, "broadcastRecipients", {
    organizationId: row.organizationId,
    broadcastId: row._id,
    contactId: contact._id,
    email: contact.email ?? "",
    messageId,
    displayIdentity: await primaryContactIdentity(ctx, contact),
    displayMessageStatus: messageId ? "queued" : null,
    skipReason: reason ?? undefined,
    settled: !!reason,
    failed: false,
  })
  return !!messageId
}

/** One recipient on its own, resolving everything per send. */
export async function sendWhatsAppRecipient(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  contact: Doc<"contacts">,
  topic: Doc<"topics"> | null,
  target: MessagingTarget
) {
  const plan = await planRecipient(ctx, row, contact, topic, target)
  return plan ? await commitRecipient(ctx, row, plan, target) : false
}

/** A broadcast step's recipients. The step resolved the account and
    template once (`target`); this plans every recipient, reserves exactly
    the sends it will queue on the number's limiter in one write, then
    writes them. `more` says whether the transaction has room for another
    recipient; the step redoes the rest of its page next time. */
export async function sendMessagingRecipients(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  contacts: Doc<"contacts">[],
  topic: Doc<"topics"> | null,
  target: MessagingTarget,
  more: () => Promise<boolean>
) {
  const plans = []
  const seen = new Set<Doc<"contacts">["_id"]>()
  for (const contact of contacts) {
    plans.push(
      seen.has(contact._id)
        ? null
        : await planRecipient(ctx, row, contact, topic, target)
    )
    seen.add(contact._id)
  }
  const sending = plans.filter((plan) => plan && !plan.reason).length
  const slots = await reserveSends(ctx, target.account, sending)
  const media = stepMedia()
  let slot = 0,
    written = 0,
    queued = 0
  for (const plan of plans) {
    if (plan) {
      const readyAt = plan.reason ? undefined : slots?.[slot++]
      if (await commitRecipient(ctx, row, plan, target, { readyAt, media }))
        queued++
    }
    written++
    if (written < plans.length && !(await more())) break
  }
  await retainStepMedia(ctx, media)
  return { written, queued, readyAt: slots?.at(-1) }
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
  template: v.optional(resolvedTemplateValue),
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
      rowChannel(row) === "email"
    )
      throw new ConvexError("Broadcast not found")
    const channel = rowChannel(row)
    if (isPageChannel(channel)) {
      await resolvePageBroadcast(ctx, organizationId, channel, row.messaging)
      return { row, topic: await audience(ctx, row) }
    }
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
    now: v.optional(v.number()),
  },
  returns: estimateValue.extend({ done: v.boolean(), cursor: v.string() }),
  handler: async (ctx, { organizationId, id, cursor, context, now }) => {
    await requireTeam(ctx, organizationId)
    const row = context?.row ?? (await ctx.db.get("broadcasts", id))
    if (
      !row ||
      row.organizationId !== organizationId ||
      row._id !== id ||
      rowChannel(row) === "email"
    )
      throw new ConvexError("Broadcast not found")
    const channel = rowChannel(row)
    const pageTarget = isPageChannel(channel)
      ? await resolvePageBroadcast(ctx, organizationId, channel, row.messaging)
      : null
    if (pageTarget && now === undefined)
      throw new ConvexError("Supply the review time")
    const template = pageTarget
      ? undefined
      : (context?.template ??
        (await resolveWhatsAppSend(ctx, organizationId, row.whatsapp))!
          .template)
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
    const config = row[BROADCAST_CAPABILITIES[channel].configKey!]!
    for (const contact of page.page) {
      let reason = await recipientSkipReason(
        ctx,
        row,
        contact,
        topic,
        template,
        config.variables,
        !pageTarget
      )
      if (!reason && pageTarget)
        reason = (
          await pageBroadcastRecipient(
            ctx,
            row,
            contact,
            pageTarget.account,
            now!
          )
        ).reason
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
    const now = Date.now()
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
        now,
      })
      result.recipients += page.recipients
      result.skipped += page.skipped
      result.noPhone += page.noPhone
      if (page.done) return result
      cursor = page.cursor
    }
  },
})
/** Recipients that failed before reasons were kept on the row read their
    message for it. */
async function legacyFailureReason(
  ctx: QueryCtx,
  organizationId: string,
  recipient: Doc<"broadcastRecipients">
) {
  if (!recipient.messageId) return undefined
  const message = await ctx.db.get("channelMessages", recipient.messageId)
  return message?.organizationId === organizationId
    ? deliveryFailureReason(message.errorCode, message.error)
    : undefined
}
export const recipients = query({
  args: { ...scope, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    publicRecipientValue.extend({
      phone: v.optional(v.string()),
      contact: v.union(
        v.null(),
        schema.doc("contacts").extend({
          channelIdentity: v.union(v.null(), contactChannelIdentityValue),
        })
      ),
      messageStatus: v.optional(channelMessageStatusValue),
      emailStatus: v.optional(emailStatusValue),
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
    const contacts = await readPageDocuments(
      ctx,
      "contacts",
      result.page.map((r) => r.contactId)
    )
    const emails = await readPageDocuments(
      ctx,
      "emails",
      result.page.flatMap((r) => (r.emailId ? [r.emailId] : []))
    )
    const statuses = recipientMessageStatuses(ctx, organizationId)
    const identities = new Map<
      Doc<"contacts">["_id"],
      ReturnType<typeof primaryContactIdentity>
    >()
    const page = await Promise.all(
      result.page.map(async (recipient) => {
        const email = recipient.emailId ? emails.get(recipient.emailId) : null
        const loaded = contacts.get(recipient.contactId)
        const contact =
          loaded?.organizationId === organizationId ? loaded : null
        let channelIdentity = recipient.displayIdentity
        if (contact && channelIdentity === undefined) {
          let identity = identities.get(contact._id)
          if (!identity) {
            identity = primaryContactIdentity(ctx, contact)
            identities.set(contact._id, identity)
          }
          channelIdentity = await identity
        }
        const messageStatus = await statuses(recipient)
        return {
          ...publicRecipient(recipient),
          failureReason:
            recipient.failureReason ??
            (messageStatus === "failed"
              ? await legacyFailureReason(ctx, organizationId, recipient)
              : undefined),
          contact: contact
            ? { ...contact, channelIdentity: channelIdentity ?? null }
            : null,
          phone: contact?.phone,
          messageStatus,
          emailStatus:
            email?.organizationId === organizationId ? email.status : undefined,
        }
      })
    )
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
/** How many audience contacts the preview looks through for a sample. */
const SAMPLE_SIZE = 200
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
    const audience = {
      ...row,
      ...(segmentId !== undefined ? { segmentId } : {}),
      ...(topicId !== undefined ? { topicId } : {}),
    }
    const whatsapp = rowChannel(row) === "whatsapp"
    // The first contacts may have no phone, so look past them.
    const page = await recipientPage(
      ctx,
      audience,
      null,
      undefined,
      SAMPLE_SIZE
    )
    const sample = page.page.find((contact) => !whatsapp || contact.phone)
    if (sample || !whatsapp || audience.segmentId || page.isDone)
      return sample ?? null
    // All contacts: any contact with a phone will do.
    return await ctx.db
      .query("contacts")
      .withIndex("by_organizationId_and_phone", (q) =>
        q.eq("organizationId", organizationId).gt("phone", "")
      )
      .first()
  },
})
