import {
  WorkflowManager,
  cleanup,
  vWorkflowId,
  vResultValidator,
} from "@convex-dev/workflow"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { patchRow, insertRow } from "./counts"
import { audience, draft, recipientPage } from "./broadcasts"
import { createEmail } from "./emails"
import { finishBroadcast } from "./broadcastMetrics"
import { unsubscribeLinks } from "./unsubscribe"
import { renderEmail } from "./email/render"
import { listProperties } from "./audience"
import { retirement } from "./teamLifecycle"

const workflow = new WorkflowManager(components.workflow)
const args = { id: v.id("broadcasts"), generation: v.number() }
export const start = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, generation }): Promise<null> => {
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.generation !== generation ||
      !["queued", "scheduled"].includes(row.status) ||
      row.audienceBefore !== undefined ||
      (await retirement(ctx, row.organizationId))
    )
      return null
    const newest = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", row.organizationId)
      )
      .order("desc")
      .first()
    await patchRow(ctx, "broadcasts", id, {
      status: "queued",
      scheduledJob: undefined,
      audienceBefore: newest?._creationTime ?? Date.now(),
    })
    await startWorkflow(ctx, id, generation)
    return null
  },
})
export const execute = workflow.define({
  args,
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    // Rotate the journal before Workflow's history limit, for any audience size.
    for (let page = 0; page < 100; page++)
      if (await step.runMutation(internal.broadcastSend.batch, args)) break
    return null
  },
})
export const batch = internalMutation({
  args,
  returns: v.boolean(),
  handler: async (ctx, { id, generation }): Promise<boolean> => {
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.generation !== generation ||
      row.status !== "queued" ||
      row.audienceDone ||
      (await retirement(ctx, row.organizationId))
    )
      return true
    await audience(ctx, row)
    const body = await draft(ctx, id)
    if (!body) throw new Error("Broadcast not found")
    const page = await recipientPage(
      ctx,
      row,
      row.cursor ?? null,
      row.audienceBefore,
      10,
      true
    )
    const properties = await listProperties(ctx, row.organizationId)
    for (const contact of page.page) {
      const previous = await ctx.db
        .query("broadcastRecipients")
        .withIndex("by_broadcastId_and_email", (q) =>
          q.eq("broadcastId", id).eq("email", contact.email)
        )
        .unique()
      if (previous) continue
      const links = await unsubscribeLinks(ctx, {
        organizationId: row.organizationId,
        contactId: contact._id,
        topicId: row.topicId ?? undefined,
        broadcastId: id,
      })
      const values: Record<string, string | undefined> = {
        FIRST_NAME: contact.firstName || undefined,
        LAST_NAME: contact.lastName || undefined,
        EMAIL: contact.email,
        "contact.first_name": contact.firstName || undefined,
        "contact.last_name": contact.lastName || undefined,
        "contact.email": contact.email,
        ...links.variables,
        RESEND_UNSUBSCRIBE_URL: links.pageUrl,
      }
      for (const property of properties) {
        const value = contact.properties[property.key] ?? property.fallbackValue
        values[property.key] = value
        values[`contact.${property.key}`] = value
        values[`contact.properties.${property.key}`] = value
      }
      const rendered = renderEmail(
        { subject: row.subject, html: body.html, text: body.text },
        values
      )
      const emailId = await createEmail(
        ctx,
        {
          ...rendered,
          from: row.from,
          to: [contact.email],
          cc: [],
          bcc: [],
          replyTo: row.replyToAddresses ?? (row.replyTo ? [row.replyTo] : []),
          headers: Object.entries(links.headers).map(([name, value]) => ({
            name,
            value,
          })),
          tags: [],
          attachments: [],
        },
        {
          organizationId: row.organizationId,
          source: "dashboard",
          broadcastId: id,
        }
      )
      await insertRow(ctx, "broadcastRecipients", {
        organizationId: row.organizationId,
        broadcastId: id,
        contactId: contact._id,
        email: contact.email,
        emailId,
        settled: false,
        failed: false,
      })
    }
    await patchRow(ctx, "broadcasts", id, {
      cursor: page.continueCursor,
      audienceDone: page.isDone,
    })
    if (page.isDone) await finishBroadcast(ctx, id)
    return page.isDone
  },
})
export const completed = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object(args),
  },
  returns: v.null(),
  handler: async (ctx, { context, result, workflowId }): Promise<null> => {
    const row = await ctx.db.get("broadcasts", context.id)
    if (
      !row ||
      row.workflowId !== workflowId ||
      (await retirement(ctx, row.organizationId))
    ) {
      await cleanup(ctx, components.workflow, workflowId)
      return null
    }
    if (
      row?.generation === context.generation &&
      row.status === "queued" &&
      result.kind !== "success"
    )
      await patchRow(ctx, "broadcasts", row._id, {
        status: "failed",
        error: result.kind === "failed" ? result.error : "Broadcast canceled",
        updatedAt: Date.now(),
      })
    if (
      result.kind === "success" &&
      row?.status === "queued" &&
      !row.audienceDone &&
      row.generation === context.generation
    )
      await startWorkflow(ctx, row._id, row.generation)
    await cleanup(ctx, components.workflow, workflowId)
    return null
  },
})

async function startWorkflow(
  ctx: MutationCtx,
  id: Id<"broadcasts">,
  generation: number
) {
  const workflowId = await workflow.start(
    ctx,
    internal.broadcastSend.execute,
    { id, generation },
    {
      startAsync: true,
      onComplete: internal.broadcastSend.completed,
      context: { id, generation },
    }
  )
  await patchRow(ctx, "broadcasts", id, { workflowId })
}
