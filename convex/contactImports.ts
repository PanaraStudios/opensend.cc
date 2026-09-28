import { contactInputValue, propertyTypeValue } from "./tables/audience"
import { ConvexError, v } from "convex/values"
import { internalMutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import { retirement } from "./teamLifecycle"
import { listProperties, teamRow, upsertContact } from "./audience"
import schema from "./schema"

const args = { id: v.id("contactImports"), offset: v.number() }
export const get = query({
  args: { id: v.id("contactImports") },
  returns: v.union(
    v.null(),
    schema.doc("contactImports").omit("contacts", "segmentIds", "skipExisting")
  ),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("contactImports", id)
    if (!row) return null
    await requireTeam(ctx, row.organizationId)
    const { contacts, segmentIds, skipExisting, ...view } = row
    void contacts
    void segmentIds
    void skipExisting
    return view
  },
})
export const step = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, offset }): Promise<null> => {
    const job = await ctx.db.get("contactImports", id)
    if (!job || job.status !== "processing" || job.offset !== offset)
      return null
    if (await retirement(ctx, job.organizationId)) {
      await ctx.db.delete("contactImports", id)
      return null
    }
    for (const segmentId of job.segmentIds)
      await teamRow(ctx, "segments", job.organizationId, segmentId)
    const properties = await listProperties(ctx, job.organizationId)
    const size = Math.min(
      100,
      Math.max(1, Math.floor(500 / Math.max(1, job.segmentIds.length)))
    )
    const end = Math.min(offset + size, job.contacts.length)
    const result = job.result
    for (const contact of job.contacts.slice(offset, end)) {
      try {
        // Each contact is a subtransaction: a validation failure never commits a partial contact.
        const outcome = await ctx.runMutation(internal.contactImports.one, {
          organizationId: job.organizationId,
          contact,
          segmentIds: job.segmentIds,
          skipExisting: job.skipExisting,
          properties: properties.map(({ key, type }) => ({ key, type })),
        })
        result[outcome.result]++
        if (outcome.result === "created") result.createdIds.push(outcome.id)
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error
        result.skipped++
        if (result.errors.length < 5) result.errors.push(String(error.data))
      }
    }
    const done = end === job.contacts.length
    await ctx.db.patch("contactImports", id, {
      offset: end,
      result,
      status: done ? "completed" : "processing",
    })
    if (!done)
      await ctx.scheduler.runAfter(0, internal.contactImports.run, {
        id,
        offset: end,
      })
    return null
  },
})
export const one = internalMutation({
  args: {
    organizationId: v.string(),
    contact: contactInputValue,
    segmentIds: v.array(v.id("segments")),
    skipExisting: v.boolean(),
    properties: v.array(v.object({ key: v.string(), type: propertyTypeValue })),
  },
  returns: v.object({
    id: v.id("contacts"),
    result: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("skipped")
    ),
  }),
  handler: async (ctx, { organizationId, contact, ...options }) =>
    upsertContact(ctx, organizationId, contact, { ...options, emit: false }),
})
export const failed = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, offset }) => {
    const job = await ctx.db.get("contactImports", id)
    if (job?.status === "processing" && job.offset === offset)
      await ctx.db.patch("contactImports", id, {
        status: "failed",
        error: "Import could not be completed. Retry the remaining contacts.",
      })
    return null
  },
})
export const run = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      await ctx.runMutation(internal.contactImports.step, args)
    } catch {
      await ctx.runMutation(internal.contactImports.failed, args)
    }
    return null
  },
})
