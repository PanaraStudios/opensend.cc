import { isPageChannel } from "../../lib/channels"
import { ConvexError, v, type Infer } from "convex/values"
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { RateLimiter, SECOND } from "@convex-dev/rate-limiter"
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal, components } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { insertRow, patchRow } from "../counts"
import { retirement } from "../teamLifecycle"
import { findMetaApp } from "../meta/app"
import { live } from "../meta/connect"
import { teamRow } from "../lists"
import { decryptSecret } from "../secrets"
import { invalid, notFound } from "../api/caller"
import { broadcastMessageMetric } from "../broadcastMetrics"
import { emitEvent } from "../events"
import { tagValue } from "../tables/emails"
import { upsertChannelThread } from "./identity"
import { channelMessagePayload } from "./payload"
import { channelStrategies } from "../../lib/meta/payloads"
import { resolveLocalTemplate } from "./templates"
import { messagingChannelValue } from "../tables/channels"
import { resolveWhatsAppTemplate } from "../whatsapp/templates"
import { STATUS_RANK, object, string } from "../../lib/meta/webhooks"
import { TAG_PATTERN } from "../../lib/dashboard/email-send"
import { RETRY_DELAYS } from "../emails"

const pool = new Workpool(components.channelPool, { maxParallelism: 10 })
const limiter = new RateLimiter(components.rateLimiter)
export const channelInputValue = v.object({
  channel: messagingChannelValue,
  from: v.optional(v.string()),
  to: v.string(),
  /** Validated by the channel adapter before any writes. */
  body: v.record(v.string(), v.any()),
  replyTo: v.optional(v.string()),
  tags: v.optional(v.array(tagValue)),
})
export type ChannelInput = Infer<typeof channelInputValue>

/** Resolve only within the team, accepting either an account id or phone id. */
export async function channelAccountAccess(
  ctx: QueryCtx,
  organizationId: string,
  from: string | undefined,
  channel: Doc<"channelAccounts">["channel"]
) {
  const account = await findChannelAccount(ctx, organizationId, from, channel)
  const strategy = channelStrategies[channel]
  if (!account) throw notFound(strategy.notFoundLabel)
  const connection = await ctx.db.get("metaConnections", account.connectionId)
  if (
    account.status !== "active" ||
    (strategy.requiresRegistration && account.registeredAt === undefined) ||
    connection?.organizationId !== organizationId ||
    connection.status !== "active"
  )
    throw invalid(strategy.inactiveLabel)
  return { account, connection }
}

/** Shared team-scoped lookup for sending and read-only REST account access. */
export async function findChannelAccount(
  ctx: QueryCtx,
  organizationId: string,
  from: string | undefined,
  channel: Doc<"channelAccounts">["channel"]
) {
  if (from !== undefined)
    return teamRow(ctx, "channelAccounts", organizationId, from, {
      keep: (account) => account.channel === channel && live(account),
      fallback: async () =>
        (
          await ctx.db
            .query("channelAccounts")
            .withIndex("by_channel_and_externalId", (q) =>
              q.eq("channel", channel).eq("externalId", from)
            )
            .take(20)
        ).find((a) => a.organizationId === organizationId && live(a)) ?? null,
    })
  const accounts = await ctx.db
    .query("channelAccounts")
    .withIndex("by_organizationId_and_channel_and_disconnectedAt", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("channel", channel)
        .eq("disconnectedAt", undefined)
    )
    .take(2)
  if (accounts.length !== 1) throw invalid("from is required")
  return accounts[0]
}
export async function resolveChannelAccount(
  ctx: QueryCtx,
  organizationId: string,
  from: string | undefined,
  channel: Doc<"channelAccounts">["channel"]
) {
  return (await channelAccountAccess(ctx, organizationId, from, channel))
    .account
}

/** A template send with `components` goes to Meta as given. Otherwise the
 * team's stored template (by id, alias, or name and language, on the sending
 * number's WABA) must be approved, and its own components are filled from
 * `variables`, so missing variables fail here rather than at Meta. A name
 * opensend has not synced yet still passes through for Meta to check. */
async function storedTemplate(
  ctx: MutationCtx,
  organizationId: string,
  wabaId: string | undefined,
  value: unknown
) {
  if (typeof value !== "object" || value === null || "components" in value)
    return value
  const ref = value as {
    id?: unknown
    alias?: unknown
    name?: unknown
    language?: unknown
    variables?: unknown
  }
  const language =
    typeof ref.language === "string"
      ? ref.language
      : typeof ref.language === "object" && ref.language !== null
        ? (ref.language as { code?: unknown }).code
        : undefined
  const byName = ref.id === undefined && ref.alias === undefined
  try {
    const template = await resolveWhatsAppTemplate(ctx, organizationId, {
      id: typeof ref.id === "string" ? ref.id : undefined,
      alias: typeof ref.alias === "string" ? ref.alias : undefined,
      name: typeof ref.name === "string" ? ref.name : undefined,
      language: typeof language === "string" ? language : undefined,
      wabaId,
    })
    const variables =
      typeof ref.variables === "object" && ref.variables !== null
        ? (ref.variables as Record<string, string | number>)
        : {}
    return {
      name: template.name,
      language: template.language,
      components: template.sendComponents(variables),
    }
  } catch (error) {
    if (
      byName &&
      error instanceof ConvexError &&
      error.data === "WhatsApp template not found"
    )
      return value
    throw error
  }
}

/** One entry point for APIs, composers, broadcasts and automations. Callers
 * authorize their team before invoking it; retirement is checked here too. */
export async function createChannelMessage(
  ctx: MutationCtx,
  input: ChannelInput,
  opts: {
    organizationId: string
    source: "api" | "dashboard" | "broadcast" | "automation"
    apiKeyId?: Id<"apiKeys">
    broadcastId?: Id<"broadcasts">
    automationRunId?: Id<"automationRuns">
  }
) {
  if (await retirement(ctx, opts.organizationId))
    throw invalid("This team is being retired.")
  const channel = input.channel
  const strategy = channelStrategies[channel]
  const account = await resolveChannelAccount(
    ctx,
    opts.organizationId,
    input.from,
    channel
  )
  let body = input.body
  let templateId: Id<"templates"> | undefined
  let prepared: ReturnType<typeof channelStrategies.whatsapp.build>
  try {
    if (body.template !== undefined) {
      if (!isPageChannel(channel))
        body = {
          ...body,
          template: await storedTemplate(
            ctx,
            opts.organizationId,
            account.wabaId,
            body.template
          ),
        }
      else {
        if (body.text !== undefined || body.attachment !== undefined)
          throw new Error("Provide exactly one message body.")
        const template = await resolveLocalTemplate(
          ctx,
          opts.organizationId,
          channel,
          body.template
        )
        templateId = template.id
        body = {
          ...template.body,
          ...(body.quick_replies !== undefined
            ? { quick_replies: body.quick_replies }
            : {}),
          ...(body.tag !== undefined ? { tag: body.tag } : {}),
        }
      }
    }
    prepared = channelStrategies[channel].build({ ...body, to: input.to })
  } catch (error) {
    throw invalid(
      error instanceof Error ? error.message : "Invalid channel message."
    )
  }
  const { payload, to: recipient, preview } = prepared
  const type = templateId ? "template" : prepared.type
  if (JSON.stringify(payload).length > 200_000)
    throw invalid("The message body is too large.")
  const tags = input.tags ?? []
  if (
    tags.length > 48 ||
    tags.some((t) => !TAG_PATTERN.test(t.name) || !TAG_PATTERN.test(t.value))
  )
    throw invalid(
      "Tags must use ASCII letters, numbers, underscores or dashes (at most 48 tags, 256 characters each)."
    )
  const now = Date.now()
  const data = strategy.mediaData(payload, type)
  const { channelContactId, conversationId } = await upsertChannelThread(
    ctx,
    account,
    {
      externalId: recipient,
      ...strategy.identity(recipient),
      at: now,
      preview,
      direction: "outbound",
    }
  )
  let replyToId: Id<"channelMessages"> | undefined
  if (input.replyTo) {
    const id = ctx.db.normalizeId("channelMessages", input.replyTo)
    const reply = id
      ? await ctx.db.get("channelMessages", id)
      : ((
          await ctx.db
            .query("channelMessages")
            .withIndex("by_channel_and_externalId", (q) =>
              q.eq("channel", channel).eq("externalId", input.replyTo)
            )
            .take(10)
        ).find(
          (row) =>
            row.accountId === account._id &&
            row.conversationId === conversationId
        ) ?? null)
    if (
      !reply ||
      reply.organizationId !== opts.organizationId ||
      reply.accountId !== account._id ||
      reply.conversationId !== conversationId ||
      !reply.externalId
    )
      throw invalid(
        "reply_to must identify a message in this recipient's conversation."
      )
    replyToId = reply._id
    Object.assign(payload, strategy.replyContext(reply.externalId))
  }
  const conversation = (await ctx.db.get("conversations", conversationId))!
  try {
    channelStrategies[channel].assertWindow(
      payload,
      conversation.windowExpiresAt,
      now
    )
  } catch (error) {
    throw invalid(
      error instanceof Error ? error.message : "Messaging window closed"
    )
  }
  const message = await insertRow(
    ctx,
    "channelMessages",
    {
      organizationId: opts.organizationId,
      channel,
      accountId: account._id,
      conversationId,
      channelContactId,
      direction: "outbound",
      from: account.externalId,
      to: recipient,
      type,
      ...(templateId ? { templateId } : {}),
      status: "queued",
      preview,
      source: opts.source,
      ...(opts.apiKeyId ? { apiKeyId: opts.apiKeyId } : {}),
      ...(opts.broadcastId ? { broadcastId: opts.broadcastId } : {}),
      ...(opts.automationRunId
        ? { automationRunId: opts.automationRunId }
        : {}),
      ...(replyToId ? { replyToId } : {}),
      ...(tags.length ? { tags } : {}),
      generation: 0,
      attempts: 0,
      expiresAt: now + 7 * 86400_000,
    },
    true
  )
  const mediaId = string(data.id)
  const upload = mediaId
    ? await ctx.db
        .query("channelMediaUploads")
        .withIndex("by_team_and_mediaId", (q) =>
          q.eq("organizationId", opts.organizationId).eq("mediaId", mediaId)
        )
        .unique()
    : null
  await ctx.db.insert("channelMessageContents", {
    messageId: message._id,
    payload: JSON.stringify(payload),
    ...(upload && upload.accountId === account._id
      ? {
          media: [
            {
              mediaId,
              contentType: upload.contentType,
              filename: upload.filename,
              size: upload.size,
            },
          ],
        }
      : {}),
  })
  await ctx.db.insert("channelMessageEvents", {
    messageId: message._id,
    type: "queued",
    at: now,
  })
  await enqueue(ctx, message._id, 0, 0)
  return message._id
}

async function enqueue(
  ctx: MutationCtx,
  id: Id<"channelMessages">,
  generation: number,
  runAfter: number
) {
  await pool.enqueueAction(
    ctx,
    internal.channels.deliver.deliver,
    { id, generation },
    {
      runAfter,
      retry: false,
      onComplete: internal.channels.messages.deliverDone,
      onCompleteExcludeKinds: ["success"],
      context: { id, generation },
    }
  )
}
async function content(ctx: QueryCtx, id: Id<"channelMessages">) {
  return ctx.db
    .query("channelMessageContents")
    .withIndex("by_messageId", (q) => q.eq("messageId", id))
    .unique()
}
export async function acceptChannelMessage(
  ctx: MutationCtx,
  message: Doc<"channelMessages">,
  externalId: string,
  at: number
) {
  if (message.sentAt !== undefined) return message
  const current = await patchRow(ctx, "channelMessages", message._id, {
    externalId,
    sentAt: at,
    claimed: false,
    ...(STATUS_RANK[message.status] < STATUS_RANK.sent
      ? { status: "sent" as const }
      : {}),
  })
  await ctx.db.insert("channelMessageEvents", {
    messageId: message._id,
    type: "sent",
    at,
  })
  await broadcastMessageMetric(ctx, current)
  const body = await content(ctx, message._id)
  await emitEvent(
    ctx,
    message.organizationId,
    `${message.channel}.message.sent`,
    channelMessagePayload(
      { ...current, status: "sent" },
      body ? object(JSON.parse(body.payload)) : {}
    )
  )
  return current
}
async function fail(
  ctx: MutationCtx,
  message: Doc<"channelMessages">,
  error: string,
  code?: number,
  title?: string
) {
  if (message.status !== "queued") return
  const current = await patchRow(ctx, "channelMessages", message._id, {
    status: "failed",
    claimed: false,
    error,
    ...(code === undefined ? {} : { errorCode: code }),
    ...(title ? { errorTitle: title } : {}),
  })
  await ctx.db.insert("channelMessageEvents", {
    messageId: message._id,
    type: "failed",
    at: Date.now(),
    details: JSON.stringify({
      code: code ?? null,
      title: title ?? null,
      message: error,
    }),
  })
  await broadcastMessageMetric(ctx, current)
  const body = await content(ctx, message._id)
  await emitEvent(
    ctx,
    message.organizationId,
    `${message.channel}.message.failed`,
    channelMessagePayload(current, body ? object(JSON.parse(body.payload)) : {})
  )
}
export const claim = internalMutation({
  args: { id: v.id("channelMessages"), generation: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      token: v.string(),
      version: v.string(),
      phoneNumberId: v.string(),
      payload: v.string(),
      messagingType: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { id, generation }) => {
    const message = await ctx.db.get("channelMessages", id)
    if (
      !message ||
      message.generation !== generation ||
      message.claimed ||
      message.status !== "queued" ||
      (await retirement(ctx, message.organizationId))
    )
      return null
    let access: Awaited<ReturnType<typeof channelAccountAccess>>
    try {
      access = await channelAccountAccess(
        ctx,
        message.organizationId,
        message.accountId,
        message.channel
      )
    } catch {
      await fail(ctx, message, "The channel account is no longer active.")
      return null
    }
    const { account, connection } = access
    const strategy = channelStrategies[message.channel]
    const app = await findMetaApp(ctx)
    const body = await content(ctx, id)
    if (!app || !body) {
      await fail(
        ctx,
        message,
        "Meta configuration or message content is missing."
      )
      return null
    }
    const conversation = await ctx.db.get(
      "conversations",
      message.conversationId
    )
    const payload = object(JSON.parse(body.payload))
    try {
      channelStrategies[message.channel].assertWindow(
        payload,
        conversation?.windowExpiresAt,
        Date.now()
      )
    } catch (error) {
      await fail(
        ctx,
        message,
        error instanceof Error ? error.message : "Messaging window closed",
        channelStrategies[message.channel].windowErrorCode
      )
      return null
    }
    let readyAt = message.rateReadyAt
    if (readyAt === undefined) {
      const { key, rate, mediaRate } = strategy.rate(account)
      const limit = await limiter.limit(ctx, "channelSend", {
        key,
        count: 1,
        reserve: true,
        config: { kind: "token bucket", rate, period: SECOND, capacity: rate },
      })
      let delay = limit.retryAfter ?? 0
      if (mediaRate && (message.type === "audio" || message.type === "video")) {
        const mediaLimit = await limiter.limit(ctx, "channelMediaSend", {
          key,
          count: 1,
          reserve: true,
          config: {
            kind: "token bucket",
            rate: mediaRate,
            period: SECOND,
            capacity: mediaRate,
          },
        })
        delay = Math.max(delay, mediaLimit.retryAfter ?? 0)
      }
      readyAt = Date.now() + Math.ceil(delay)
    }
    if (readyAt > Date.now()) {
      await patchRow(ctx, "channelMessages", id, {
        generation: generation + 1,
        rateReadyAt: readyAt,
      })
      await enqueue(ctx, id, generation + 1, readyAt - Date.now())
      return null
    }
    const token = await decryptSecret(
      account.encryptedToken ?? connection.encryptedToken
    )
    await patchRow(ctx, "channelMessages", id, {
      claimed: true,
      rateReadyAt: undefined,
      attempts: message.attempts + 1,
    })
    return {
      token,
      version: app.graphVersion,
      phoneNumberId: channelStrategies[message.channel].endpoint(account),
      payload: body.payload,
      ...(typeof payload.messaging_type === "string"
        ? { messagingType: payload.messaging_type }
        : {}),
    }
  },
})
const outcomeValue = v.union(
  v.object({ kind: v.literal("sent"), externalId: v.string() }),
  v.object({
    kind: v.literal("failed"),
    error: v.string(),
    title: v.optional(v.string()),
    code: v.optional(v.number()),
    action: v.union(
      v.literal("retry"),
      v.literal("retry_after"),
      v.literal("final"),
      v.literal("token_invalid")
    ),
  })
)
async function recordOutcome(
  ctx: MutationCtx,
  args: {
    id: Id<"channelMessages">
    generation: number
    outcome: Infer<typeof outcomeValue>
  }
) {
  const message = await ctx.db.get("channelMessages", args.id)
  if (
    !message ||
    message.generation !== args.generation ||
    (await retirement(ctx, message.organizationId))
  )
    return
  const outcome = args.outcome
  if (outcome.kind === "sent") {
    if (
      message.status === "queued" ||
      message.externalId === outcome.externalId
    )
      await acceptChannelMessage(ctx, message, outcome.externalId, Date.now())
    return
  }
  if (message.status !== "queued" || message.sentAt !== undefined) return
  if (outcome.code === 131050)
    await ctx.db.patch("channelContacts", message.channelContactId, {
      marketingOptOut: true,
    })
  if (outcome.action === "token_invalid") {
    const account = await ctx.db.get("channelAccounts", message.accountId)
    const connection = account
      ? await ctx.db.get("metaConnections", account.connectionId)
      : null
    if (
      connection?.status === "active" &&
      connection.organizationId === message.organizationId
    )
      await ctx.db.patch("metaConnections", connection._id, {
        status: "error",
        error: outcome.error,
        checkedAt: Date.now(),
      })
  }
  if (
    (outcome.action === "retry" || outcome.action === "retry_after") &&
    message.attempts <= RETRY_DELAYS.length
  ) {
    const next = args.generation + 1
    await patchRow(ctx, "channelMessages", message._id, {
      generation: next,
      claimed: false,
    })
    await enqueue(
      ctx,
      message._id,
      next,
      Math.max(
        outcome.action === "retry_after" ? 6000 : 0,
        RETRY_DELAYS[message.attempts - 1] ?? RETRY_DELAYS[0]
      )
    )
  } else await fail(ctx, message, outcome.error, outcome.code, outcome.title)
}
export const record = internalMutation({
  args: {
    id: v.id("channelMessages"),
    generation: v.number(),
    outcome: outcomeValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordOutcome(ctx, args)
    return null
  },
})
/** Graph has no send idempotency key: a crash may already have sent. */
export const deliverDone = internalMutation({
  args: vOnCompleteArgs(
    v.object({ id: v.id("channelMessages"), generation: v.number() })
  ),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") return null
    const message = await ctx.db.get("channelMessages", context.id)
    if (
      message?.status === "queued" &&
      message.generation === context.generation &&
      !message.claimed
    )
      await patchRow(ctx, "channelMessages", message._id, {
        attempts: message.attempts + 1,
      })
    await recordOutcome(ctx, {
      ...context,
      outcome: {
        kind: "failed",
        error:
          result.kind === "failed"
            ? "The send was interrupted"
            : "The send was canceled",
        action: "final",
      },
    })
    return null
  },
})
