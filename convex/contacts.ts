import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { BOOLEANS, countValue, counters } from "./counts"
import { matchesSearch } from "./lists"
import {
  BATCH,
  CLEANUP_BATCH,
  deleteContact,
  emitContact,
  joinSegments,
  listProperties,
  purgeContactRows,
  setMembership,
  setTopicChoice,
  teamRow,
  updateContact,
  upsertContact,
  withSegments,
} from "./audience"
import { topicSubscriptionValue } from "./tables/audience"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"

const contactWithSegments = schema
  .doc("contacts")
  .extend({ segmentIds: v.array(v.id("segments")) })

const inBatch = <T>(items: T[]) => {
  if (items.length > BATCH)
    throw new ConvexError(`Send at most ${BATCH} contacts at a time`)
  return [...new Set(items)]
}

const contactFilters = {
  organizationId: v.string(),
  /** Part of the email or a name, as typed. */
  search: v.optional(v.string()),
  unsubscribed: v.optional(v.boolean()),
  segmentId: v.optional(v.id("segments")),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
}

/** Newest first. A search ranks by relevance instead; filters that its
    index cannot apply are applied to each page, so a page may come back
    short. */
export const list = query({
  args: { ...contactFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(contactWithSegments),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const { organizationId, unsubscribed, segmentId } = args
    const from = args.from ?? 0
    const to = args.to ?? Number.MAX_SAFE_INTEGER
    const search = (args.search ?? "").trim().slice(0, 256)
    const matches = matchesSearch(search)
    // A segment deleted while filtered on just lists what is left of it.
    const segment = segmentId && (await ctx.db.get("segments", segmentId))
    if (segment && segment.organizationId !== organizationId)
      throw new ConvexError("Segment not found")
    /* The search index matches any word of the search; the list keeps
       only contacts that contain all of it, as typed. */
    const inRange = (contact: Doc<"contacts">) =>
      contact._creationTime >= from &&
      contact._creationTime <= to &&
      (unsubscribed === undefined || contact.unsubscribed === unsubscribed) &&
      matches(
        contact.email,
        contact.firstName,
        contact.lastName,
        `${contact.firstName} ${contact.lastName}`
      )

    if (!search && segmentId) {
      const members = await ctx.db
        .query("segmentMembers")
        .withIndex("by_segmentId", (q) => q.eq("segmentId", segmentId))
        .order("desc")
        .paginate(args.paginationOpts)
      const page = []
      for (const member of members.page) {
        const contact = await ctx.db.get("contacts", member.contactId)
        if (contact && inRange(contact))
          page.push(await withSegments(ctx, contact))
      }
      return { ...members, page }
    }
    const contacts = search
      ? await ctx.db
          .query("contacts")
          .withSearchIndex("search_search", (q) => {
            const scoped = q
              .search("search", search)
              .eq("organizationId", organizationId)
            return unsubscribed === undefined
              ? scoped
              : scoped.eq("unsubscribed", unsubscribed)
          })
          .paginate(args.paginationOpts)
      : await (
          unsubscribed === undefined
            ? ctx.db
                .query("contacts")
                .withIndex("by_organizationId", (q) =>
                  q
                    .eq("organizationId", organizationId)
                    .gte("_creationTime", from)
                    .lte("_creationTime", to)
                )
            : ctx.db
                .query("contacts")
                .withIndex("by_organizationId_and_unsubscribed", (q) =>
                  q
                    .eq("organizationId", organizationId)
                    .eq("unsubscribed", unsubscribed)
                    .gte("_creationTime", from)
                    .lte("_creationTime", to)
                )
        )
          .order("desc")
          .paginate(args.paginationOpts)
    const page = []
    for (const contact of contacts.page) {
      if (!inRange(contact)) continue
      const row = await withSegments(ctx, contact)
      if (!segmentId || row.segmentIds.includes(segmentId)) page.push(row)
    }
    return { ...contacts, page }
  },
})

/** How many contacts the list's filters match. A search is not counted,
    nor a segment together with other filters. */
export const count = query({
  args: contactFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    const range = { from: args.from, to: args.to }
    if (!args.segmentId)
      return {
        total: await counters.contacts.total(
          ctx,
          args.organizationId,
          [{ is: args.unsubscribed, among: BOOLEANS }],
          range
        ),
      }
    const segment = await ctx.db.get("segments", args.segmentId)
    if (segment?.organizationId !== args.organizationId) return { total: 0 }
    if (args.unsubscribed !== undefined || args.from || args.to)
      return { total: null }
    return { total: await counters.segmentMembers.total(ctx, segment._id) }
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    contactWithSegments.extend({
      topics: v.array(
        v.object({
          topicId: v.id("topics"),
          subscription: topicSubscriptionValue,
        })
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("contacts", id)
    const contact = normalized ? await ctx.db.get("contacts", normalized) : null
    if (!contact) return null
    await requireTeam(ctx, contact.organizationId)
    const choices = await ctx.db
      .query("topicSubscriptions")
      .withIndex("by_contactId_and_topicId", (q) =>
        q.eq("contactId", contact._id)
      )
      .take(200)
    return {
      ...(await withSegments(ctx, contact)),
      topics: choices.map(({ topicId, subscription }) => ({
        topicId,
        subscription,
      })),
    }
  },
})

const contactInput = v.object({
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  unsubscribed: v.optional(v.boolean()),
  properties: v.optional(v.record(v.string(), v.string())),
})

/** Creates or merges contacts by email; one batch of an import or of
    "Add manually". Every contact joins `segmentIds`. A row that fails
    validation is skipped and counted; with `skipExisting`, so is an address
    already in the team. */
export const upsert = mutation({
  args: {
    organizationId: v.string(),
    contacts: v.array(contactInput),
    segmentIds: v.array(v.id("segments")),
    skipExisting: v.optional(v.boolean()),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    skipped: v.number(),
    createdIds: v.array(v.id("contacts")),
    errors: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const inputs = inBatch(args.contacts)
    const segmentIds = [...new Set(args.segmentIds)]
    for (const id of segmentIds)
      await teamRow(ctx, "segments", args.organizationId, id)
    const properties = await listProperties(ctx, args.organizationId)
    const out = {
      created: 0,
      updated: 0,
      skipped: 0,
      createdIds: [] as Id<"contacts">[],
      errors: [] as string[],
    }
    for (const input of inputs) {
      try {
        const { id, result } = await upsertContact(
          ctx,
          args.organizationId,
          input,
          { properties, segmentIds, skipExisting: args.skipExisting }
        )
        out[result] += 1
        if (result === "created") out.createdIds.push(id)
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error
        out.skipped += 1
        if (out.errors.length < 5) out.errors.push(String(error.data))
      }
    }
    return out
  },
})

async function writableContact(ctx: MutationCtx, id: Id<"contacts">) {
  const contact = await ctx.db.get("contacts", id)
  if (!contact) throw new ConvexError("Contact not found")
  await requireTeam(ctx, contact.organizationId, "write")
  return contact
}
/** The team's contacts among `ids`; ids that are gone are left out. */
async function teamContacts(
  ctx: MutationCtx,
  organizationId: string,
  ids: Id<"contacts">[]
) {
  const contacts = []
  for (const id of inBatch(ids)) {
    const contact = await ctx.db.get("contacts", id)
    if (!contact) continue
    if (contact.organizationId !== organizationId)
      throw new ConvexError("Contact not found")
    contacts.push(contact)
  }
  return contacts
}

export const update = mutation({
  args: {
    id: v.id("contacts"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    unsubscribed: v.optional(v.boolean()),
    /** Merged into the stored values; "" clears a property. */
    properties: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...patch }) => {
    await updateContact(ctx, await writableContact(ctx, id), patch)
    return null
  },
})

export const remove = mutation({
  args: { organizationId: v.string(), ids: v.array(v.id("contacts")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    for (const contact of await teamContacts(
      ctx,
      args.organizationId,
      args.ids
    ))
      await deleteContact(ctx, contact)
    return null
  },
})

/** Puts one contact in or out of one segment. */
export const setSegment = mutation({
  args: {
    id: v.id("contacts"),
    segmentId: v.id("segments"),
    member: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const contact = await writableContact(ctx, args.id)
    await teamRow(ctx, "segments", contact.organizationId, args.segmentId)
    if (await setMembership(ctx, contact, args.segmentId, args.member))
      // The contact's `segment_ids` changed.
      await emitContact(ctx, "contact.updated", contact)
    return null
  },
})

export const addToSegments = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.id("contacts")),
    segmentIds: v.array(v.id("segments")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const segmentIds = [...new Set(args.segmentIds)]
    for (const id of segmentIds)
      await teamRow(ctx, "segments", args.organizationId, id)
    await joinSegments(
      ctx,
      await teamContacts(ctx, args.organizationId, args.ids),
      segmentIds
    )
    return null
  },
})

export const setTopic = mutation({
  args: {
    id: v.id("contacts"),
    topicId: v.id("topics"),
    subscription: topicSubscriptionValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const contact = await writableContact(ctx, args.id)
    await teamRow(ctx, "topics", contact.organizationId, args.topicId)
    await setTopicChoice(ctx, contact, args.topicId, args.subscription)
    return null
  },
})

export const subscribeToTopics = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.id("contacts")),
    topicIds: v.array(v.id("topics")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const topicIds = [...new Set(args.topicIds)]
    for (const id of topicIds)
      await teamRow(ctx, "topics", args.organizationId, id)
    for (const contact of await teamContacts(
      ctx,
      args.organizationId,
      args.ids
    ))
      for (const topicId of topicIds)
        await setTopicChoice(ctx, contact, topicId, "subscribed")
    return null
  },
})

/** Finishes deleting a contact's memberships and topic choices. */
export const purge = internalMutation({
  args: { contactId: v.id("contacts") },
  returns: v.null(),
  handler: async (ctx, { contactId }) => {
    if (!(await purgeContactRows(ctx, contactId, CLEANUP_BATCH)))
      await ctx.scheduler.runAfter(0, internal.contacts.purge, { contactId })
    return null
  },
})
