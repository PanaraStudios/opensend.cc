import { broadcastChannels, validateBroadcastSend } from "./broadcastChannels"
import { rowChannel } from "../lib/meta/templates"
import { ConvexError, v, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import {
  action,
  query,
  mutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import {
  counters,
  countValue,
  insertRow,
  patchRow,
  deleteRow,
  retireBroadcastCounters,
} from "./counts"
import { stream } from "convex-helpers/server/stream"
import { filteredPage, matchesSearch, selectedOption } from "./lists"
import {
  BROADCAST_STATUSES,
  broadcastStatusValue,
  broadcastEventValue,
  broadcastChannel,
  whatsappBroadcast,
} from "./tables/broadcasts"
import { teamRow } from "./audience"
import { parseMailbox } from "../lib/dashboard/email-send"
import { MAX_SCHEDULE } from "./emails"
import { TEMPLATE_BODY_LIMIT } from "./templates"

export const fields = {
  channel: v.optional(broadcastChannel),
  whatsapp: v.optional(whatsappBroadcast),
  name: v.optional(v.string()),
  subject: v.optional(v.string()),
  preview: v.optional(v.string()),
  from: v.optional(v.string()),
  replyTo: v.optional(v.string()),
  replyToAddresses: v.optional(v.array(v.string())),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
  content: v.optional(v.any()),
  segmentId: v.optional(v.union(v.id("segments"), v.null())),
  topicId: v.optional(v.union(v.id("topics"), v.null())),
}
export const inputValue = v.object(fields)
export type BroadcastInput = Infer<typeof inputValue>
export const draft = (ctx: QueryCtx, id: Id<"broadcasts">) =>
  ctx.db
    .query("broadcastDrafts")
    .withIndex("by_broadcastId", (q) => q.eq("broadcastId", id))
    .unique()
export async function audience(
  ctx: QueryCtx,
  row: Pick<Doc<"broadcasts">, "organizationId" | "segmentId" | "topicId">
) {
  if (row.segmentId)
    await teamRow(ctx, "segments", row.organizationId, row.segmentId)
  return row.topicId
    ? teamRow(ctx, "topics", row.organizationId, row.topicId)
    : null
}
async function check(
  ctx: MutationCtx,
  organizationId: string,
  input: BroadcastInput
) {
  for (const key of ["name", "subject", "preview", "from", "replyTo"] as const)
    if ((input[key]?.length ?? 0) > (key === "subject" ? 998 : 1000))
      throw new ConvexError(`${key} is too long`)
  for (const key of ["html", "text", "content"] as const)
    if (
      new TextEncoder().encode(
        typeof input[key] === "string"
          ? (input[key] as string)
          : JSON.stringify(input[key] ?? null)
      ).length > TEMPLATE_BODY_LIMIT
    )
      throw new ConvexError("The broadcast content is larger than 256 KB")
  if (input.from && !parseMailbox(input.from))
    throw new ConvexError("Invalid from address")
  if (input.replyTo && !parseMailbox(input.replyTo))
    throw new ConvexError("Invalid reply-to address")
  if (
    input.replyToAddresses &&
    (input.replyToAddresses.length > 50 ||
      input.replyToAddresses.some((a) => !parseMailbox(a)))
  )
    throw new ConvexError("Invalid reply-to addresses")
  await broadcastChannels[rowChannel(input)].validate(
    ctx,
    organizationId,
    input
  )
  await audience(ctx, {
    organizationId,
    segmentId: input.segmentId ?? null,
    topicId: input.topicId ?? null,
  })
}
export async function insertBroadcast(
  ctx: MutationCtx,
  organizationId: string,
  input: BroadcastInput
) {
  await check(ctx, organizationId, input)
  const { html, text, content, ...row } = await broadcastChannels[
    rowChannel(input)
  ].initialize(ctx, organizationId, input)
  const id = await insertRow(ctx, "broadcasts", {
    ...row,
    organizationId,
    name: input.name ?? "Untitled",
    subject: input.subject ?? "",
    preview: input.preview ?? "",
    segmentId: input.segmentId ?? null,
    topicId: input.topicId ?? null,
    status: "draft",
    updatedAt: Date.now(),
    generation: 0,
    audienceDone: false,
  })
  await ctx.db.insert("broadcastDrafts", {
    organizationId,
    broadcastId: id,
    html: html ?? "",
    ...(text === undefined ? {} : { text }),
    ...(content == null ? {} : { content }),
  })
  return id
}
export async function updateBroadcast(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  input: BroadcastInput
) {
  const changed = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as BroadcastInput
  if (
    !["draft", "canceled"].includes(row.status) &&
    Object.keys(changed).some((key) => key !== "name")
  )
    throw new ConvexError("Only draft broadcasts can be updated")
  if (changed.channel && changed.channel !== rowChannel(row))
    throw new ConvexError("A broadcast’s channel cannot be changed")
  await check(ctx, row.organizationId, { ...changed, channel: rowChannel(row) })
  const { html, text, content, ...patch } = changed
  if (changed.replyTo !== undefined && changed.replyToAddresses === undefined)
    patch.replyToAddresses = changed.replyTo.trim()
      ? [changed.replyTo.trim()]
      : []
  await patchRow(ctx, "broadcasts", row._id, {
    ...patch,
    updatedAt: Date.now(),
  })
  const body = await draft(ctx, row._id)
  if (body)
    await ctx.db.patch("broadcastDrafts", body._id, {
      ...(html === undefined ? {} : { html }),
      ...(text === undefined ? {} : { text }),
      ...("content" in changed ? { content: content ?? undefined } : {}),
    })
}
export async function duplicateBroadcast(
  ctx: MutationCtx,
  row: Doc<"broadcasts">
) {
  const body = await draft(ctx, row._id)
  return insertBroadcast(ctx, row.organizationId, {
    name: `${row.name || "Untitled"} copy`,
    channel: row.channel,
    whatsapp: row.whatsapp,
    subject: row.subject,
    preview: row.preview,
    from: row.from,
    replyTo: row.replyTo,
    replyToAddresses: row.replyToAddresses,
    segmentId: row.segmentId,
    topicId: row.topicId,
    html: body?.html,
    text: body?.text,
    content: body?.content,
  })
}
export async function removeBroadcast(
  ctx: MutationCtx,
  row: Doc<"broadcasts">
) {
  if (!["draft", "scheduled", "canceled"].includes(row.status))
    throw new ConvexError("Only unsent broadcasts can be deleted")
  if (row.scheduledJob) await ctx.scheduler.cancel(row.scheduledJob)
  const body = await draft(ctx, row._id)
  if (body) await ctx.db.delete("broadcastDrafts", body._id)
  await retireBroadcastCounters(ctx, row._id)
  await deleteRow(ctx, "broadcasts", row._id)
}
export async function sendBroadcast(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  scheduledAt?: number
) {
  if (!["draft", "canceled", "scheduled"].includes(row.status))
    throw new ConvexError("Broadcast has already been sent")
  await audience(ctx, row)
  await validateBroadcastSend(ctx, row)
  if (
    scheduledAt !== undefined &&
    (!Number.isFinite(scheduledAt) || scheduledAt > Date.now() + MAX_SCHEDULE)
  )
    throw new ConvexError("The `scheduled_at` must be within the next 30 days.")
  if (row.scheduledJob) await ctx.scheduler.cancel(row.scheduledJob)
  const at = scheduledAt && scheduledAt > Date.now() ? scheduledAt : undefined
  const generation = row.generation + 1
  const scheduledJob = await ctx.scheduler.runAt(
    at ?? Date.now(),
    internal.broadcastSend.start,
    { id: row._id, generation }
  )
  await patchRow(ctx, "broadcasts", row._id, {
    status: at ? "scheduled" : "queued",
    settledAt: undefined,
    retainedStats: undefined,
    generation,
    scheduledAt: at,
    scheduledJob,
    audienceDone: false,
    cursor: undefined,
    error: undefined,
    updatedAt: Date.now(),
  })
}
export async function cancelBroadcast(
  ctx: MutationCtx,
  row: Doc<"broadcasts">
) {
  if (
    row.status !== "scheduled" &&
    !(row.status === "queued" && row.audienceBefore === undefined)
  )
    throw new ConvexError("Only scheduled broadcasts can be canceled")
  if (row.scheduledJob) await ctx.scheduler.cancel(row.scheduledJob)
  await patchRow(ctx, "broadcasts", row._id, {
    status: "canceled",
    settledAt: Date.now(),
    scheduledAt: undefined,
    scheduledJob: undefined,
    generation: row.generation + 1,
    updatedAt: Date.now(),
  })
}
async function writable(ctx: MutationCtx, id: Id<"broadcasts">) {
  const row = await ctx.db.get("broadcasts", id)
  if (!row) throw new ConvexError("Broadcast not found")
  await requireTeam(ctx, row.organizationId, "write")
  return row
}
export const create = mutation({
  args: { organizationId: v.string(), ...fields },
  returns: v.id("broadcasts"),
  handler: async (ctx, { organizationId, ...input }) => {
    await requireTeam(ctx, organizationId, "write")
    return insertBroadcast(ctx, organizationId, input)
  },
})
export const update = mutation({
  args: { id: v.id("broadcasts"), ...fields },
  returns: v.null(),
  handler: async (ctx, { id, ...input }) => {
    await updateBroadcast(ctx, await writable(ctx, id), input)
    return null
  },
})
export const duplicate = mutation({
  args: { id: v.id("broadcasts") },
  returns: v.id("broadcasts"),
  handler: async (ctx, { id }) =>
    duplicateBroadcast(ctx, await writable(ctx, id)),
})
export const remove = mutation({
  args: { id: v.id("broadcasts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await removeBroadcast(ctx, await writable(ctx, id))
    return null
  },
})
export const send = mutation({
  args: { id: v.id("broadcasts"), scheduledAt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, scheduledAt }): Promise<null> => {
    await sendBroadcast(ctx, await writable(ctx, id), scheduledAt)
    return null
  },
})
export const cancel = mutation({
  args: { id: v.id("broadcasts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await cancelBroadcast(ctx, await writable(ctx, id))
    return null
  },
})
export const filters = {
  search: v.optional(v.string()),
  status: v.optional(broadcastStatusValue),
  audience: v.optional(v.string()),
  channel: v.optional(broadcastChannel),
}
export function broadcastPage(
  ctx: QueryCtx,
  args: {
    search?: string
    status?: Doc<"broadcasts">["status"]
    audience?: string
    channel?: "email" | "whatsapp"
  } & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const matches = matchesSearch(args.search)
  const query = stream(ctx.db, schema).query("broadcasts")
  const segmentId =
    args.audience === "everyone"
      ? null
      : args.audience
        ? ctx.db.normalizeId("segments", args.audience)
        : undefined
  const rows =
    args.status && segmentId !== undefined
      ? query.withIndex("by_organizationId_and_status_and_segmentId", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("status", args.status!)
            .eq("segmentId", segmentId)
        )
      : args.status
        ? query.withIndex("by_organizationId_and_status", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("status", args.status!)
          )
        : segmentId !== undefined
          ? query.withIndex("by_organizationId_and_segmentId", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("segmentId", segmentId)
            )
          : query.withIndex("by_organizationId", (q) =>
              q.eq("organizationId", args.organizationId)
            )
  return filteredPage(
    rows.order("desc"),
    args.paginationOpts,
    (row) =>
      (!args.audience || (row.segmentId ?? "everyone") === args.audience) &&
      (!args.channel || rowChannel(row) === args.channel) &&
      matches(row.name, row.subject),
    { rows: 512, bytes: 4 * 1024 * 1024 },
    args.search
  )
}
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...filters,
  },
  returns: paginationResultValidator(schema.doc("broadcasts")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return broadcastPage(ctx, args)
  },
})
export const count = query({
  args: { organizationId: v.string(), ...filters },
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return {
      total:
        args.search?.trim() || args.channel
          ? null
          : await counters.broadcasts.total(ctx, args.organizationId, [
              { is: args.status, among: BROADCAST_STATUSES },
              { is: args.audience, among: [] },
            ]),
    }
  },
})
export const get = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      row: schema.doc("broadcasts"),
      body: v.union(schema.doc("broadcastDrafts"), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const row = await selectedOption(
      ctx,
      "broadcasts",
      args.organizationId,
      args.id
    )
    if (!row) return null
    return { row, body: await draft(ctx, row._id) }
  },
})
/** The audience, a page at a time. The review counts who will get the
    email; the send (`sending`) also takes suppressed addresses, which the
    pipeline records as suppressed emails without sending, as Resend does. */
export async function recipientPage(
  ctx: QueryCtx,
  row: Pick<Doc<"broadcasts">, "organizationId" | "segmentId" | "topicId"> & {
    channel?: "email" | "whatsapp"
  },
  cursor: string | null,
  before?: number,
  size = 100,
  sending = false,
  loadedTopic?: Doc<"topics"> | null
) {
  const topic =
    loadedTopic === undefined ? await audience(ctx, row) : loadedTopic
  const page = row.segmentId
    ? await ctx.db
        .query("segmentMembers")
        .withIndex("by_segmentId", (q) => q.eq("segmentId", row.segmentId!))
        .paginate({ numItems: size, cursor })
    : await ctx.db
        .query("contacts")
        .withIndex("by_organizationId", (q) =>
          q
            .eq("organizationId", row.organizationId)
            .lte("_creationTime", before ?? Number.MAX_SAFE_INTEGER)
        )
        .paginate({ numItems: size, cursor })
  const candidates: Doc<"contacts">[] = []
  for (const entry of page.page) {
    const contact =
      "contactId" in entry
        ? await ctx.db.get("contacts", entry.contactId)
        : entry
    if (
      contact &&
      contact.organizationId === row.organizationId &&
      contact._creationTime <= (before ?? Number.MAX_SAFE_INTEGER)
    )
      candidates.push(contact)
  }
  const contacts = await broadcastChannels[rowChannel(row)].eligible(
    ctx,
    row,
    candidates,
    topic,
    sending
  )
  return { ...page, page: contacts }
}
export const reviewPage = internalQuery({
  args: {
    organizationId: v.string(),
    segmentId: v.union(v.id("segments"), v.null()),
    topicId: v.union(v.id("topics"), v.null()),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    count: v.number(),
    done: v.boolean(),
    cursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const page = await recipientPage(ctx, args, args.cursor)
    return {
      count: page.page.length,
      done: page.isDone,
      cursor: page.continueCursor,
    }
  },
})
export const review = action({
  args: {
    organizationId: v.string(),
    segmentId: v.union(v.id("segments"), v.null()),
    topicId: v.union(v.id("topics"), v.null()),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    let cursor: string | null = null
    let count = 0
    for (;;) {
      const page: { count: number; done: boolean; cursor: string } =
        await ctx.runQuery(internal.broadcasts.reviewPage, { ...args, cursor })
      count += page.count
      if (page.done) return count
      cursor = page.cursor
    }
  },
})
export const history = query({
  args: {
    organizationId: v.string(),
    email: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("broadcasts")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const result = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_organizationId_and_email", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("email", args.email.toLowerCase())
      )
      .order("desc")
      .paginate(args.paginationOpts)
    const page = []
    for (const recipient of result.page) {
      const row = await ctx.db.get("broadcasts", recipient.broadcastId)
      if (row) page.push(row)
    }
    return { ...result, page }
  },
})
export const eventList = query({
  args: {
    id: v.id("broadcasts"),
    type: broadcastEventValue,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("broadcastEvents")),
  handler: async (ctx, { id, type, paginationOpts }) => {
    const row = await ctx.db.get("broadcasts", id)
    if (!row) throw new ConvexError("Broadcast not found")
    await requireTeam(ctx, row.organizationId)
    return ctx.db
      .query("broadcastEvents")
      .withIndex("by_broadcastId_and_type", (q) =>
        q.eq("broadcastId", id).eq("type", type)
      )
      .order("desc")
      .paginate(paginationOpts)
  },
})

export const historyCount = query({
  args: { organizationId: v.string(), email: v.string() },
  returns: countValue,
  handler: async (ctx, { organizationId, email }) => {
    await requireTeam(ctx, organizationId)
    return {
      total: await counters.broadcastHistory.total(
        ctx,
        JSON.stringify([organizationId, email.toLowerCase()])
      ),
    }
  },
})
export const eventCount = query({
  args: { id: v.id("broadcasts"), type: broadcastEventValue },
  returns: countValue,
  handler: async (ctx, { id, type }) => {
    const row = await ctx.db.get("broadcasts", id)
    if (!row) throw new ConvexError("Broadcast not found")
    await requireTeam(ctx, row.organizationId)
    return {
      total: await counters.broadcastEvents.total(ctx, id, [
        { is: type, among: [] },
      ]),
    }
  },
})
