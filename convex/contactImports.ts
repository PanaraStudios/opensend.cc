import { insertRow, patchRow, deleteRow } from "./counts"
import {
  contactInputValue,
  propertyTypeValue,
  topicSubscriptionValue,
} from "./tables/audience"
import { ConvexError, v, type Infer } from "convex/values"
import { internalMutation, query, type MutationCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import { retirement } from "./teamLifecycle"
import {
  BATCH,
  MEMBERSHIP_BATCH,
  listProperties,
  teamRow,
  upsertContact,
  setTopicChoices,
} from "./audience"
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
      await deleteRow(ctx, "contactImports", id)
      return null
    }
    for (const segmentId of job.segmentIds)
      await teamRow(ctx, "segments", job.organizationId, segmentId)
    const properties = await listProperties(ctx, job.organizationId)
    // Each contact's memberships past its own share join in scheduled steps.
    const size = Math.min(
      BATCH,
      Math.max(
        1,
        Math.floor(
          MEMBERSHIP_BATCH /
            Math.max(1, job.segmentIds.length + (job.topics?.length ?? 0))
        )
      )
    )
    const end = Math.min(offset + size, job.contacts.length)
    const result = job.result
    let failedCount = job.failedCount ?? 0
    for (const contact of job.contacts.slice(offset, end)) {
      try {
        // Each contact is a subtransaction: a validation failure never commits a partial contact.
        const outcome = await ctx.runMutation(internal.contactImports.one, {
          organizationId: job.organizationId,
          contact,
          segmentIds: job.segmentIds,
          skipExisting: job.skipExisting,
          topics: job.topics,
          properties: properties.map(({ key, type }) => ({ key, type })),
        })
        result[outcome.result]++
        if (outcome.result === "created") result.createdIds.push(outcome.id)
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error
        result.skipped++
        failedCount++
        if (result.errors.length < 5) result.errors.push(String(error.data))
      }
    }
    const done = end === job.contacts.length
    await patchRow(ctx, "contactImports", id, {
      offset: end,
      result,
      failedCount,
      ...(done ? { completedAt: Date.now() } : {}),
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
    topics: v.optional(
      v.array(
        v.object({
          topicId: v.id("topics"),
          subscription: topicSubscriptionValue,
        })
      )
    ),
  },
  returns: v.object({
    id: v.id("contacts"),
    result: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("skipped")
    ),
  }),
  handler: async (ctx, { organizationId, contact, topics, ...options }) => {
    const result = await upsertContact(ctx, organizationId, contact, {
      ...options,
      emit: false,
      mergePhone: true,
    })
    if (topics?.length && result.result !== "skipped")
      await setTopicChoices(
        ctx,
        (await ctx.db.get("contacts", result.id))!,
        topics,
        { emit: false }
      )
    return result
  },
})
export const failed = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, offset }) => {
    const job = await ctx.db.get("contactImports", id)
    if (job?.status === "processing" && job.offset === offset)
      await patchRow(ctx, "contactImports", id, {
        status: "failed",
        completedAt: Date.now(),
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

export async function enqueueImport(
  ctx: MutationCtx,
  input: {
    organizationId: string
    contacts: Infer<typeof contactInputValue>[]
    segmentIds: import("./_generated/dataModel").Id<"segments">[]
    skipExisting: boolean
    topics?: {
      topicId: import("./_generated/dataModel").Id<"topics">
      subscription: Infer<typeof topicSubscriptionValue>
    }[]
  }
) {
  if (
    !input.contacts.length ||
    input.contacts.length > 500 ||
    new TextEncoder().encode(JSON.stringify(input)).byteLength > 500_000
  )
    throw new ConvexError(
      "Imports support 1–500 rows and at most 500 KB of parsed data. Use smaller batches."
    )
  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    createdIds: [],
    errors: [],
  }
  const jobId = await insertRow(ctx, "contactImports", {
    ...input,
    status: "processing",
    offset: 0,
    result,
    failedCount: 0,
  })
  await ctx.scheduler.runAfter(0, internal.contactImports.run, {
    id: jobId,
    offset: 0,
  })
  return { ...result, jobId }
}
