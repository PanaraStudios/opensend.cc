import type { MutationCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { LIMITS, listProperties } from "./audience"
import { countValue, counters, deleteRow, insertRow, patchRow } from "./counts"
import { matchesSearch, teamPage } from "./lists"
import { propertyTypeValue } from "./tables/audience"
import {
  normalizePropertyKey,
  propertyKeyError,
} from "../lib/dashboard/contacts"

/** Contacts a stripping pass rewrites before handing on to the next. */
const STRIP_BATCH = 200

const propertyFilters = {
  organizationId: v.string(),
  search: v.optional(v.string()),
}

// 512 property rows, no hydration; 4 MiB leaves ample transaction headroom.
export const PROPERTY_SEARCH_BUDGET = { rows: 512, bytes: 4 * 1024 * 1024 }

/** The team's custom properties, newest first, a page at a time. */
export const list = query({
  args: { ...propertyFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("contactProperties")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const matches = matchesSearch(args.search)
    return teamPage(
      ctx,
      "contactProperties",
      args.organizationId,
      args.paginationOpts,
      // One being deleted is already gone for the team.
      (property) => !property.deleting && matches(property.name, property.key),
      PROPERTY_SEARCH_BUDGET,
      args.search
    )
  },
})

export const count = query({
  args: propertyFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return {
      total: await counters.contactProperties.total(ctx, args.organizationId),
    }
  },
})

/** Every custom property of the team, newest first, for pickers. */
export const options = query({
  args: { organizationId: v.string() },
  returns: v.array(schema.doc("contactProperties")),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    return (await listProperties(ctx, organizationId)).sort(
      (a, b) => b._creationTime - a._creationTime
    )
  },
})

export const create = mutation({
  args: {
    organizationId: v.string(),
    key: v.string(),
    name: v.string(),
    type: propertyTypeValue,
    fallbackValue: v.optional(v.string()),
  },
  returns: v.id("contactProperties"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    return createProperty(ctx, args)
  },
})

/** Hides the property at once and strips its values from every contact in
    batches; the key is free again once that finishes. There is no update:
    a property's key and type are what stored values were written against. */
export const remove = mutation({
  args: { id: v.id("contactProperties") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const property = await ctx.db.get("contactProperties", id)
    if (!property || property.deleting)
      throw new ConvexError("Property not found")
    await requireTeam(ctx, property.organizationId, "write")
    return removeProperty(ctx, property)
  },
})

export const strip = internalMutation({
  args: {
    id: v.id("contactProperties"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { id, cursor }) => {
    const property = await ctx.db.get("contactProperties", id)
    if (!property) return null
    const { page, isDone, continueCursor } = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", property.organizationId)
      )
      .paginate({ cursor, numItems: STRIP_BATCH })
    for (const contact of page) {
      if (!(property.key in contact.properties)) continue
      const { [property.key]: _removed, ...properties } = contact.properties
      void _removed
      await patchRow(ctx, "contacts", contact._id, { properties })
    }
    if (isDone) await deleteRow(ctx, "contactProperties", id)
    else
      await ctx.scheduler.runAfter(0, internal.contactProperties.strip, {
        id,
        cursor: continueCursor,
      })
    return null
  },
})

export async function createProperty(
  ctx: MutationCtx,
  args: Omit<Doc<"contactProperties">, "_id" | "_creationTime" | "deleting">
) {
  const key = normalizePropertyKey(args.key)
  // Keys still being stripped count as taken.
  const taken = await ctx.db
    .query("contactProperties")
    .withIndex("by_organizationId_and_key", (q) =>
      q.eq("organizationId", args.organizationId)
    )
    .take(LIMITS.properties * 2)
  const error = propertyKeyError(
    key,
    taken.map((row) => row.key)
  )
  if (error) throw new ConvexError(error)
  if (taken.filter((row) => !row.deleting).length >= LIMITS.properties)
    throw new ConvexError(
      `A team can have up to ${LIMITS.properties} properties`
    )
  const fallbackValue = args.fallbackValue?.trim() || undefined
  const name = args.name.trim() || key
  if (name.length > 200 || (fallbackValue?.length ?? 0) > 1000)
    throw new ConvexError("That name or fallback value is too long")
  if (
    args.type === "number" &&
    fallbackValue &&
    !Number.isFinite(Number(fallbackValue))
  )
    throw new ConvexError("The fallback must be a number")
  return insertRow(ctx, "contactProperties", {
    organizationId: args.organizationId,
    key,
    name,
    type: args.type,
    fallbackValue,
  })
}

export async function removeProperty(
  ctx: MutationCtx,
  property: Doc<"contactProperties">
) {
  const id = property._id
  await patchRow(ctx, "contactProperties", id, { deleting: true })
  await ctx.scheduler.runAfter(0, internal.contactProperties.strip, {
    id,
    cursor: null,
  })
  return null
}

export async function updateProperty(
  ctx: MutationCtx,
  property: Doc<"contactProperties">,
  fallbackValue: string | undefined
) {
  if (fallbackValue === undefined) return
  if (
    fallbackValue.length > 1000 ||
    (property.type === "number" && !Number.isFinite(Number(fallbackValue)))
  )
    throw new ConvexError("Invalid property fallback value")
  await patchRow(ctx, "contactProperties", property._id, { fallbackValue })
}
