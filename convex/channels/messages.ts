import { ConvexError, v, type Infer } from "convex/values"
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { RateLimiter, SECOND } from "@convex-dev/rate-limiter"
import {
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal, components } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { requireTeam } from "../access"
import { insertRow, patchRow } from "../counts"
import { retirement } from "../teamLifecycle"
import { findMetaApp } from "../meta/app"
import { live } from "../meta/connect"
import { decryptSecret } from "../secrets"
import { invalid, notFound } from "../api/caller"
import { emitEvent } from "../events"
import { tagValue } from "../tables/emails"
import { upsertWhatsAppThread } from "./identity"
import { channelMessagePayload } from "./payload"
import { whatsappPayload, type WhatsAppBody } from "../../lib/meta/payloads"
import { resolveWhatsAppTemplate } from "../whatsapp/templates"
import { STATUS_RANK, object, string } from "../../lib/meta/webhooks"
import { TAG_PATTERN } from "../../lib/dashboard/email-send"
import { RETRY_DELAYS } from "../emails"

const pool = new Workpool(components.channelPool, { maxParallelism: 10 })
const limiter = new RateLimiter(components.rateLimiter)
export const WINDOW_CLOSED =
  "The 24-hour customer service window is closed. Send an approved template instead."
export const channelInputValue = v.object({
  from: v.optional(v.string()),
  to: v.string(),
  /** Validated by whatsappPayload before any writes. */
  body: v.record(v.string(), v.any()),
  replyTo: v.optional(v.string()),
  tags: v.optional(v.array(tagValue)),
})
export type ChannelInput = Infer<typeof channelInputValue>

/** Resolve only within the team, accepting either an account id or phone id. */
export async function resolveWhatsAppAccount(
  ctx: QueryCtx,
  organizationId: string,
  from?: string
) {
  let account: Doc<"channelAccounts"> | null = null
  if (from !== undefined) {
    const id = ctx.db.normalizeId("channelAccounts", from)
    if (id) account = await ctx.db.get("channelAccounts", id)
    else
      account =
        (
          await ctx.db
            .query("channelAccounts")
            .withIndex("by_channel_and_externalId", (q) =>
              q.eq("channel", "whatsapp").eq("externalId", from)
            )
            .take(20)
        ).find((a) => a.organizationId === organizationId && live(a)) ?? null
  } else {
    const accounts = await ctx.db
      .query("channelAccounts")
      .withIndex("by_organizationId_and_channel_and_disconnectedAt", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("channel", "whatsapp")
          .eq("disconnectedAt", undefined)
      )
      .take(2)
    if (accounts.length !== 1) throw invalid("from is required")
    account = accounts[0]
  }
  if (
    !account ||
    account.organizationId !== organizationId ||
    account.channel !== "whatsapp" ||
    !live(account)
  )
    throw notFound("WhatsApp phone number")
  const connection = await ctx.db.get("metaConnections", account.connectionId)
  if (
    account.status !== "active" ||
    account.registeredAt === undefined ||
    connection?.organizationId !== organizationId ||
    connection.status !== "active"
  )
    throw invalid(
      "The WhatsApp phone number must be active and registered with an active Meta connection."
    )
  return account
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
  const account = await resolveWhatsAppAccount(
    ctx,
    opts.organizationId,
    input.from
  )
  let payload: ReturnType<typeof whatsappPayload>
  try {
    payload = whatsappPayload({
      ...input.body,
      ...(input.body.template !== undefined
        ? {
            template: await storedTemplate(
              ctx,
              opts.organizationId,
              account.wabaId,
              input.body.template
            ),
          }
        : {}),
      to: input.to,
      reply_to: input.replyTo,
    } as WhatsAppBody)
  } catch (error) {
    throw invalid(
      error instanceof Error ? error.message : "Invalid WhatsApp message."
    )
  }
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
  let replyToId: Id<"channelMessages"> | undefined
  if (input.replyTo) {
    const id = ctx.db.normalizeId("channelMessages", input.replyTo)
    const reply = id
      ? await ctx.db.get("channelMessages", id)
      : await ctx.db
          .query("channelMessages")
          .withIndex("by_channel_and_externalId", (q) =>
            q.eq("channel", "whatsapp").eq("externalId", input.replyTo)
          )
          .unique()
    if (
      !reply ||
      reply.organizationId !== opts.organizationId ||
      reply.accountId !== account._id ||
      (reply.direction === "inbound" ? reply.from : reply.to) !== payload.to ||
      !reply.externalId
    )
      throw invalid(
        "reply_to must identify a message in this recipient's conversation."
      )
    replyToId = reply._id
    payload.context = { message_id: reply.externalId }
  }
  const data = object(payload[payload.type])
  const preview = (
    payload.type === "text"
      ? string(data.body)
      : string(data.caption) || `[${payload.type}]`
  ).slice(0, 1000)
  const { channelContactId, conversationId } = await upsertWhatsAppThread(
    ctx,
    account,
    {
      externalId: payload.to,
      phone: `+${payload.to}`,
      at: now,
      preview,
      direction: "outbound",
    }
  )
  const conversation = (await ctx.db.get("conversations", conversationId))!
  if (payload.type !== "template" && (conversation.windowExpiresAt ?? 0) <= now)
    throw invalid(WINDOW_CLOSED)
  const message = await insertRow(
    ctx,
    "channelMessages",
    {
      organizationId: opts.organizationId,
      channel: "whatsapp",
      accountId: account._id,
      conversationId,
      channelContactId,
      direction: "outbound",
      from: account.externalId,
      to: payload.to,
      type: payload.type,
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
      search: [account.handle, payload.to, preview].join(" "),
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

/** Future inbox callers get the same authorization and send validation. */
export const send = mutation({
  args: { organizationId: v.string(), input: channelInputValue },
  returns: v.id("channelMessages"),
  handler: async (ctx, { organizationId, input }) => {
    await requireTeam(ctx, organizationId, "write")
    return createChannelMessage(ctx, input, {
      organizationId,
      source: "dashboard",
    })
  },
})
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
  const body = await content(ctx, message._id)
  await emitEvent(
    ctx,
    message.organizationId,
    "whatsapp.message.sent",
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
  const body = await content(ctx, message._id)
  await emitEvent(
    ctx,
    message.organizationId,
    "whatsapp.message.failed",
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
    let account: Doc<"channelAccounts">
    try {
      account = await resolveWhatsAppAccount(
        ctx,
        message.organizationId,
        message.accountId
      )
    } catch {
      await fail(
        ctx,
        message,
        "The WhatsApp account is no longer active and registered."
      )
      return null
    }
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
    if (
      message.type !== "template" &&
      (conversation?.windowExpiresAt ?? 0) <= Date.now()
    ) {
      await fail(ctx, message, WINDOW_CLOSED, 131047)
      return null
    }
    let readyAt = message.rateReadyAt
    if (readyAt === undefined) {
      const rate = Math.max(1, account.throughputMps)
      const limit = await limiter.limit(ctx, "channelSend", {
        key: account._id,
        count: 1,
        reserve: true,
        config: { kind: "token bucket", rate, period: SECOND, capacity: rate },
      })
      readyAt = Date.now() + Math.ceil(limit.retryAfter ?? 0)
    }
    if (readyAt > Date.now()) {
      await patchRow(ctx, "channelMessages", id, {
        generation: generation + 1,
        rateReadyAt: readyAt,
      })
      await enqueue(ctx, id, generation + 1, readyAt - Date.now())
      return null
    }
    const connection = (await ctx.db.get(
      "metaConnections",
      account.connectionId
    ))!
    const token = await decryptSecret(connection.encryptedToken)
    await patchRow(ctx, "channelMessages", id, {
      claimed: true,
      rateReadyAt: undefined,
      attempts: message.attempts + 1,
    })
    return {
      token,
      version: app.graphVersion,
      phoneNumberId: account.externalId,
      payload: body.payload,
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
