import { enqueueImport } from "./contactImports"
import { includeSelected, OPTION_LIMIT } from "../lib/dashboard/options"
import { selectedOption, readTeamRow, prefixOptions } from "./lists"
import { stream } from "convex-helpers/server/stream"
import { v, ConvexError, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import { retirement } from "./teamLifecycle"
import schema from "./schema"
import { BOOLEANS, countValue, counters } from "./counts"
import { filteredPage, matchesSearch } from "./lists"
import {
  primaryContactIdentity,
  BATCH,
  CLEANUP_BATCH,
  contactMemberships,
  deleteContact,
  emitContact,
  joinContact,
  joinSegments,
  listProperties,
  membershipBudget,
  purgeContactRows,
  segmentInput,
  setMembership,
  setTopicChoices,
  teamRow,
  updateContact,
  upsertContact,
} from "./audience"
import {
  contactInputValue,
  importResultValue,
  topicSubscriptionValue,
} from "./tables/audience"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

export const contactChannelIdentityValue = schema
  .doc("channelContacts")
  .pick("channel", "externalId", "profileName", "phone")
const contactWithIdentityValue = schema
  .doc("contacts")
  .extend({ channelIdentity: v.union(v.null(), contactChannelIdentityValue) })

const inBatch = <T>(items: T[]) => {
  if (items.length > BATCH)
    throw new ConvexError(`Send at most ${BATCH} contacts at a time`)
  return [...new Set(items)]
}

const contactFilters = v.object({
  organizationId: v.string(),
  /** Part of the email or a name, as typed. */
  search: v.optional(v.string()),
  unsubscribed: v.optional(v.boolean()),
  segmentId: v.optional(v.id("segments")),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
})

// Scan bounded contact pages; the list hydrates one identity per kept row.
export const CONTACT_SEARCH_BUDGET = {
  rows: 1024,
  bytes: 8 * 1024 * 1024,
}

/** Newest first; substring search filters each bounded index page. */
export async function contactPage(
  ctx: QueryCtx,
  args: Infer<typeof contactFilters> & { paginationOpts: PaginationOptions }
) {
  const { organizationId, unsubscribed, segmentId } = args
  const from = args.from ?? 0
  const to = args.to ?? Number.MAX_SAFE_INTEGER
  const search = args.search
  const matches = matchesSearch(search)
  // A segment deleted while filtered on just lists what is left of it.
  const segment = segmentId && (await ctx.db.get("segments", segmentId))
  if (segment && segment.organizationId !== organizationId)
    throw new ConvexError("Segment not found")
  const inRange = (contact: Doc<"contacts">) =>
    contact.organizationId === organizationId &&
    contact._creationTime >= from &&
    contact._creationTime <= to &&
    (unsubscribed === undefined || contact.unsubscribed === unsubscribed) &&
    matches(
      contact.email,
      contact.phone,
      contact.firstName,
      contact.lastName,
      `${contact.firstName} ${contact.lastName}`
    )

  if (segmentId && !search?.trim()) {
    const members = await ctx.db
      .query("segmentMembers")
      .withIndex("by_segmentId", (q) => q.eq("segmentId", segmentId))
      .order("desc")
      .paginate(args.paginationOpts)
    const page = []
    for (const member of members.page) {
      const contact = await ctx.db.get("contacts", member.contactId)
      if (contact && inRange(contact)) page.push(contact)
    }
    return { ...members, page }
  }
  return filteredPage(
    (unsubscribed === undefined
      ? stream(ctx.db, schema)
          .query("contacts")
          .withIndex("by_organizationId", (q) =>
            q
              .eq("organizationId", organizationId)
              .gte("_creationTime", from)
              .lte("_creationTime", to)
          )
      : stream(ctx.db, schema)
          .query("contacts")
          .withIndex("by_organizationId_and_unsubscribed", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("unsubscribed", unsubscribed)
              .gte("_creationTime", from)
              .lte("_creationTime", to)
          )
    ).order("desc"),
    args.paginationOpts,
    async (contact) =>
      inRange(contact) &&
      (!segmentId ||
        !!(await ctx.db
          .query("segmentMembers")
          .withIndex("by_contactId_and_segmentId", (q) =>
            q.eq("contactId", contact._id).eq("segmentId", segmentId)
          )
          .first())),
    CONTACT_SEARCH_BUDGET,
    search
  )
}
export const list = query({
  args: { ...contactFilters.fields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(contactWithIdentityValue),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const result = await contactPage(ctx, args)
    const page = await Promise.all(
      result.page.map(async (contact) => ({
        ...contact,
        channelIdentity: await primaryContactIdentity(ctx, contact),
      }))
    )
    return { ...result, page }
  },
})

/** The contact's segments, most recently joined first, a page at a time. */
export const segments = query({
  args: { id: v.id("contacts"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    schema.doc("segments").pick("_id", "name")
  ),
  handler: async (ctx, { id, paginationOpts }) => {
    const contact = await ctx.db.get("contacts", id)
    if (!contact) return { page: [], isDone: true, continueCursor: "" }
    await requireTeam(ctx, contact.organizationId)
    const result = await contactMemberships(ctx, id).paginate(paginationOpts)
    const page = []
    // A segment deleted a moment ago may still have memberships to purge.
    for (const member of result.page) {
      const segment = await ctx.db.get("segments", member.segmentId)
      if (segment) page.push({ _id: segment._id, name: segment.name })
    }
    return { ...result, page }
  },
})

/** How many contacts the list's filters match. A search is not counted,
    nor a segment together with other filters. */
export const count = query({
  args: contactFilters.fields,
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
    contactWithIdentityValue.extend({
      topics: v.array(
        v.object({
          topicId: v.id("topics"),
          subscription: topicSubscriptionValue,
        })
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const contact = await readTeamRow(ctx, "contacts", id)
    if (!contact) return null
    const choices = await ctx.db
      .query("topicSubscriptions")
      .withIndex("by_contactId_and_topicId", (q) =>
        q.eq("contactId", contact._id)
      )
      .take(200)
    return {
      ...contact,
      channelIdentity: await primaryContactIdentity(ctx, contact),
      topics: choices.map(({ topicId, subscription }) => ({
        topicId,
        subscription,
      })),
    }
  },
})

/** Creates or merges contacts by email; one batch of an import or of
    "Add manually". Every contact joins `segmentIds`. A row that fails
    validation is skipped and counted; with `skipExisting`, so is an address
    already in the team. */
export const upsert = mutation({
  args: {
    organizationId: v.string(),
    contacts: v.array(contactInputValue),
    segmentIds: v.array(v.id("segments")),
    skipExisting: v.optional(v.boolean()),
    csvImport: v.optional(v.boolean()),
  },
  returns: importResultValue.extend({
    jobId: v.optional(v.id("contactImports")),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const inputs = inBatch(args.contacts)
    const segmentIds = segmentInput(args.segmentIds)
    for (const id of segmentIds)
      await teamRow(ctx, "segments", args.organizationId, id)
    if (args.csvImport) {
      return enqueueImport(ctx, {
        organizationId: args.organizationId,
        contacts: inputs,
        segmentIds,
        skipExisting: args.skipExisting ?? false,
      })
    }
    const properties = await listProperties(ctx, args.organizationId)
    const out = {
      created: 0,
      updated: 0,
      skipped: 0,
      createdIds: [] as Id<"contacts">[],
      errors: [] as string[],
    }
    // Memberships past one transaction's share join in scheduled steps.
    const budget = membershipBudget()
    for (const input of inputs) {
      try {
        const { id, result } = await upsertContact(
          ctx,
          args.organizationId,
          input,
          {
            properties,
            segmentIds,
            skipExisting: args.skipExisting,
            emit: !args.csvImport,
            budget,
          }
        )
        out[result] += 1
        if (result === "created") out.createdIds.push(id)
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error
        out.skipped += 1
        if (out.errors.length < 5) out.errors.push(String(error.data))
      }
    }
    return { ...out, jobId: undefined }
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
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
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
    const segmentIds = segmentInput(args.segmentIds)
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
    await setTopicChoices(ctx, contact, [
      { topicId: args.topicId, subscription: args.subscription },
    ])
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
      await setTopicChoices(
        ctx,
        contact,
        topicIds.map((topicId) => ({ topicId, subscription: "subscribed" }))
      )
    return null
  },
})

/** Joins a contact to the rest of a request's segments; see `joinContact`. */
export const joinRest = internalMutation({
  args: {
    contactId: v.id("contacts"),
    segmentIds: v.array(v.id("segments")),
    changed: v.boolean(),
    emit: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { contactId, segmentIds, changed, emit }) => {
    const contact = await ctx.db.get("contacts", contactId)
    // The contact, or its whole team, was deleted in between.
    if (!contact || (await retirement(ctx, contact.organizationId))) return null
    await joinContact(ctx, contact, segmentIds, membershipBudget(), {
      emit,
      changed,
      recheck: true,
    })
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

export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    selectedId: v.optional(v.id("contacts")),
  },
  returns: v.array(
    schema
      .doc("contacts")
      .pick("_id", "email", "phone", "firstName", "lastName")
      .extend({
        channelIdentity: v.union(v.null(), contactChannelIdentityValue),
      })
  ),
  handler: async (ctx, { organizationId, search, selectedId }) => {
    await requireTeam(ctx, organizationId, "read")
    const prefix = search?.trim().toLowerCase() ?? ""
    let rows = await prefixOptions(ctx, "contacts", organizationId, prefix)
    if (prefix && rows.length < OPTION_LIMIT) {
      const names = await ctx.db
        .query("contacts")
        .withSearchIndex("search_search", (q) =>
          q.search("search", prefix).eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
      rows = [
        ...rows,
        ...names.filter((row) => !rows.some((item) => item._id === row._id)),
      ].slice(0, OPTION_LIMIT)
    }
    const selected = await selectedOption(
      ctx,
      "contacts",
      organizationId,
      selectedId
    )
    return Promise.all(
      includeSelected(rows, selected, (row) => row._id).map(
        async (contact) => ({
          _id: contact._id,
          email: contact.email,
          phone: contact.phone,
          firstName: contact.firstName,
          lastName: contact.lastName,
          channelIdentity: await primaryContactIdentity(ctx, contact),
        })
      )
    )
  },
})
