import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { CLEANUP_BATCH, LIMITS, requireRoom } from "./audience"
import { countValue, counters, deleteRow, insertRow, patchRow } from "./counts"
import { matchesSearch, teamPage } from "./lists"
import { topicDefaultValue, topicVisibilityValue } from "./tables/audience"
import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

function topicText(input: { name?: string; description?: string }) {
  const name = input.name?.trim()
  const description = input.description?.trim()
  if (name !== undefined && (!name || name.length > 200))
    throw new ConvexError("Name a topic in 1 to 200 characters")
  if (description && description.length > 1000)
    throw new ConvexError("Descriptions are limited to 1000 characters")
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  }
}

const topicFilters = {
  organizationId: v.string(),
  search: v.optional(v.string()),
}

/** The team's topics, newest first, a page at a time. */
export const list = query({
  args: { ...topicFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("topics")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const matches = matchesSearch(args.search)
    return teamPage(
      ctx,
      "topics",
      args.organizationId,
      args.paginationOpts,
      (topic) => matches(topic.name, topic.description)
    )
  },
})

export const count = query({
  args: topicFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return { total: await counters.topics.total(ctx, args.organizationId) }
  },
})

/** Every topic of the team, newest first, for pickers. */
export const options = query({
  args: { organizationId: v.string() },
  returns: v.array(schema.doc("topics")),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    return ctx.db
      .query("topics")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .take(LIMITS.topics)
  },
})

export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.string(),
    defaultSubscription: topicDefaultValue,
    visibility: topicVisibilityValue,
  },
  returns: v.id("topics"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    return createTopic(ctx, args)
  },
})

async function writable(ctx: MutationCtx, id: Id<"topics">) {
  const topic = await ctx.db.get("topics", id)
  if (!topic) throw new ConvexError("Topic not found")
  await requireTeam(ctx, topic.organizationId, "write")
  return topic
}

/** The default subscription is not here: it decides every contact without
    an explicit choice, so it is fixed when the topic is created. */
export const update = mutation({
  args: {
    id: v.id("topics"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(topicVisibilityValue),
  },
  returns: v.null(),
  handler: async (ctx, { id, visibility, ...text }) => {
    await writable(ctx, id)
    return updateTopic(ctx, { id, visibility, ...text })
  },
})

/** The topic goes at once; contacts' choices for it follow in batches.
    Broadcasts that name it are still demo data; the broadcasts lane must
    clear their reference server-side. */
export const remove = mutation({
  args: { id: v.id("topics") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await writable(ctx, id)
    return removeTopic(ctx, id)
  },
})

async function purgeChoices(ctx: MutationCtx, topicId: Id<"topics">) {
  const rows = await ctx.db
    .query("topicSubscriptions")
    .withIndex("by_topicId_and_subscription", (q) => q.eq("topicId", topicId))
    .take(CLEANUP_BATCH)
  for (const row of rows) await ctx.db.delete("topicSubscriptions", row._id)
  if (rows.length === CLEANUP_BATCH)
    await ctx.scheduler.runAfter(0, internal.topics.purge, { topicId })
}
export const purge = internalMutation({
  args: { topicId: v.id("topics") },
  returns: v.null(),
  handler: async (ctx, { topicId }) => {
    await purgeChoices(ctx, topicId)
    return null
  },
})

export async function createTopic(
  ctx: MutationCtx,
  args: Omit<Doc<"topics">, "_id" | "_creationTime">
) {
  const text = topicText(args)
  await requireRoom(ctx, "topics", args.organizationId)
  return insertRow(ctx, "topics", {
    ...args,
    name: text.name!,
    description: text.description ?? "",
  })
}

export async function updateTopic(
  ctx: MutationCtx,
  {
    id,
    visibility,
    ...text
  }: {
    id: Id<"topics">
    name?: string
    description?: string
    visibility?: "public" | "private"
  }
) {
  await patchRow(ctx, "topics", id, {
    ...topicText(text),
    ...(visibility ? { visibility } : {}),
  })
  return null
}

export async function removeTopic(ctx: MutationCtx, id: Id<"topics">) {
  await deleteRow(ctx, "topics", id)
  await purgeChoices(ctx, id)
  return null
}
