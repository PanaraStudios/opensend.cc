import { v, ConvexError } from "convex/values"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { LIMITS, listProperties } from "./audience"
import { propertyTypeValue } from "./tables/audience"
import {
  normalizePropertyKey,
  propertyKeyError,
} from "../lib/dashboard/contacts"

/** Contacts a stripping pass rewrites before handing on to the next. */
const STRIP_BATCH = 200

/** Every custom property of the team, newest first. */
export const list = query({
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
    return ctx.db.insert("contactProperties", {
      organizationId: args.organizationId,
      key,
      name,
      type: args.type,
      fallbackValue,
    })
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
    await ctx.db.patch("contactProperties", id, { deleting: true })
    await ctx.scheduler.runAfter(0, internal.contactProperties.strip, {
      id,
      cursor: null,
    })
    return null
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
      await ctx.db.patch("contacts", contact._id, { properties })
    }
    if (isDone) await ctx.db.delete("contactProperties", id)
    else
      await ctx.scheduler.runAfter(0, internal.contactProperties.strip, {
        id,
        cursor: continueCursor,
      })
    return null
  },
})
