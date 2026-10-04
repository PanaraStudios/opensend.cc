import { resolveReference, resolveText } from "../lib/automation-references"
import { SYSTEM_EVENT_CATALOG } from "../lib/event-catalog"
import { channelForSendStep } from "../lib/channels"
import schema from "./schema"
import { retirement } from "./teamLifecycle"
import { ConvexError, v } from "convex/values"
import {
  WorkflowManager,
  cancel,
  cleanup,
  sendEvent,
  vWorkflowId,
  vResultValidator,
  type WorkflowId,
} from "@convex-dev/workflow"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { deleteRow, insertRow, patchRow } from "./counts"
import { customEventName } from "./automationEvents"
import {
  deleteContact,
  contactEventData,
  eventSegmentIds,
  joinSegments,
  listProperties,
  teamRow,
  updateContact,
  upsertContact,
} from "./audience"
import {
  createChannelMessage,
  resolveChannelAccount,
} from "./channels/messages"
import { findWhatsAppIdentity, findPageIdentity } from "./channels/identity"
import { resolveVariables } from "../lib/meta/variables"
import { recipientSkipReason, resolveWhatsAppSend } from "./broadcastWhatsApp"
import { createEmail } from "./emails"
import { publishedTemplate, renderTemplate } from "./templates"
import { unsubscribeLinks } from "./unsubscribe"
import { readGraph } from "./automationDefinition"
import { payloadValue } from "./tables/automations"
import {
  evaluateRule,
  findStep,
  parseDuration,
} from "../lib/dashboard/automation"
import { parseMailbox, senderDomainOf } from "../lib/dashboard/email-send"
import { UNSUBSCRIBE_VARIABLE_NAME } from "../lib/dashboard/email-variables"
import type { AutomationStep } from "../lib/dashboard/types"

const workflow = new WorkflowManager(components.workflow)
const BATCH = 20
const waitResult = v.object({
  received: v.boolean(),
  payload: v.optional(payloadValue),
})

export async function startRun(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  contact: Doc<"contacts"> | null,
  payload: Record<string, unknown>,
  eventId?: Id<"events">
): Promise<Id<"automationRuns">> {
  if (eventId) {
    const existing = await ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId_and_eventId", (q) =>
        q
          .eq("organizationId", automation.organizationId)
          .eq("automationId", automation._id)
          .eq("eventId", eventId)
      )
      .unique()
    if (existing) return existing._id
  }
  const run = await insertRow(
    ctx,
    "automationRuns",
    {
      organizationId: automation.organizationId,
      automationId: automation._id,
      contactId: contact?._id,
      contactEmail: contact?.email,
      payload,
      graph: automation.graph,
      apiDefinition: automation.apiDefinition,
      trigger: automation.trigger,
      status: "running",
      sent: 0,
      ...(eventId ? { eventId, lastSignalEventId: eventId } : {}),
    },
    true
  )
  const id = run._id
  await insertRow(ctx, "automationRunSteps", {
    organizationId: run.organizationId,
    automationId: automation._id,
    runId: id,
    key: "start",
    type: "trigger",
    status: "completed",
    startedAt: run._creationTime,
    runStartedAt: run._creationTime,
    completedAt: run._creationTime,
    inputs: payload,
    output: payload,
  })
  const workflowId = await workflow.start(
    ctx,
    internal.automationRuntime.execute,
    { id, graph: automation.graph },
    {
      onComplete: internal.automationRuntime.completed,
      context: { id },
      startAsync: true,
    }
  )
  await patchRow(ctx, "automationRuns", id, { workflowId })
  return id
}

export const execute = workflow.define({
  args: { id: v.id("automationRuns"), graph: v.string() },
  returns: v.null(),
  handler: async (step, { id, graph }): Promise<null> => {
    const walk = async (steps: AutomationStep[]): Promise<boolean> => {
      for (const node of steps) {
        const result = await step.runMutation(
          internal.automationRuntime.perform,
          { id, key: node.key }
        )
        if (result.stopped) return false
        if (node.type === "place_call") {
          const output = await step.runAction(
            internal.calling.outbound.automationPlace,
            { id, key: node.key },
            { retry: false }
          )
          if (
            !(await step.runMutation(internal.automationRuntime.finishCall, {
              id,
              key: node.key,
              output,
            }))
          )
            return false
        } else if (node.type === "delay") {
          await step.sleep(result.sleepMs ?? parseDuration(node.duration)!, {
            name: node.key,
          })
          if (
            !(await step.runMutation(internal.automationRuntime.finishWait, {
              id,
              key: node.key,
              received: false,
            }))
          )
            return false
        } else if (node.type === "wait_for_event") {
          const outcome = await step.awaitEvent({
            name: node.key,
            validator: waitResult,
          })
          if (
            !(await step.runMutation(internal.automationRuntime.finishWait, {
              id,
              key: node.key,
              ...outcome,
            }))
          )
            return false
          if (!(await walk(outcome.received ? node.received : node.timedOut)))
            return false
        } else if (node.type === "condition") {
          if (!(await walk(result.met ? node.met : node.notMet))) return false
        }
      }
      return true
    }
    await walk(readGraph(graph))
    return null
  },
})
const stepRow = (ctx: MutationCtx, run: Doc<"automationRuns">, key: string) =>
  ctx.db
    .query("automationRunSteps")
    .withIndex("by_organizationId_and_runId_and_key", (q) =>
      q
        .eq("organizationId", run.organizationId)
        .eq("runId", run._id)
        .eq("key", key)
    )
    .unique()
async function active(ctx: MutationCtx, id: Id<"automationRuns">) {
  const run = await ctx.db.get("automationRuns", id)
  if (!run || run.status !== "running") return null
  const automation = await ctx.db.get("automations", run.automationId)
  return automation &&
    !automation.deleted &&
    !(await retirement(ctx, run.organizationId))
    ? run
    : null
}
export const perform = internalMutation({
  args: { id: v.id("automationRuns"), key: v.string() },
  returns: v.object({
    stopped: v.boolean(),
    met: v.optional(v.boolean()),
    sleepMs: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    { id, key }
  ): Promise<{ stopped: boolean; met?: boolean; sleepMs?: number }> => {
    const run = await active(ctx, id)
    if (!run) return { stopped: true }
    const node = findStep(readGraph(run.graph), key)
    if (!node) throw new ConvexError("Step not found")
    const previous = await stepRow(ctx, run, key)
    if (previous)
      return {
        stopped: previous.status === "failed",
        ...(node.type === "delay" && typeof previous.output?.until === "string"
          ? {
              sleepMs: Math.max(
                0,
                Date.parse(previous.output.until) - Date.now()
              ),
            }
          : {}),
        ...(node.type === "condition"
          ? { met: previous.output?.condition_met === true }
          : {}),
      }
    const stepId = await insertRow(ctx, "automationRunSteps", {
      organizationId: run.organizationId,
      automationId: run.automationId,
      runId: id,
      key,
      type: node.type,
      status: "running",
      startedAt: Date.now(),
      runStartedAt: run._creationTime,
    })
    try {
      // A subtransaction prevents a caught validation failure from committing
      // partial audience changes or a queued email.
      const result = await ctx.runMutation(internal.automationRuntime.effect, {
        run,
        node: JSON.stringify(node),
      })
      if (result.waiting) {
        await patchRow(ctx, "automationRunSteps", stepId, {
          output: result.output,
        })
        return {
          stopped: false,
          ...(result.sleepMs !== undefined ? { sleepMs: result.sleepMs } : {}),
        }
      }
      await patchRow(ctx, "automationRunSteps", stepId, {
        status: result.skipped ? "skipped" : "completed",
        completedAt: Date.now(),
        output: result.skipped
          ? { ...result.output, status: "skipped" }
          : result.output,
      })
      return {
        stopped: false,
        ...(node.type === "condition"
          ? { met: result.output.condition_met === true }
          : {}),
      }
    } catch (error) {
      await patchRow(ctx, "automationRunSteps", stepId, {
        status: "failed",
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })
      await patchRow(ctx, "automationRuns", id, {
        status: "failed",
        completedAt: Date.now(),
      })
      return { stopped: true }
    }
  },
})
export const effect = internalMutation({
  args: { run: schema.doc("automationRuns"), node: v.string() },
  returns: v.object({
    output: payloadValue,
    skipped: v.optional(v.boolean()),
    waiting: v.optional(v.boolean()),
    sleepMs: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    { run, node: serializedNode }
  ): Promise<{
    output: Record<string, unknown>
    skipped?: boolean
    waiting?: boolean
    sleepMs?: number
  }> => {
    // Only perform calls this subtransaction, after validating this snapshot.
    let node = JSON.parse(serializedNode) as AutomationStep
    const id = run._id
    const key = node.key
    const contact = run.contactId
      ? await ctx.db.get("contacts", run.contactId)
      : null
    const records = await ctx.db
      .query("automationRunSteps")
      .withIndex("by_organizationId_and_runId_and_key", (q) =>
        q.eq("organizationId", run.organizationId).eq("runId", id)
      )
      .take(101)
    const scope = {
      trigger: run.payload,
      event: run.payload,
      contact: contact
        ? contactEventData(contact, await eventSegmentIds(ctx, contact._id))
        : ((run.payload.contact as Record<string, unknown> | undefined) ?? {}),
      steps: Object.fromEntries(
        records
          .filter((s) => s.status === "completed" || s.status === "skipped")
          .map((s) => [s.key, s.output ?? {}])
      ),
    }
    const resolve = (value: unknown): unknown => {
      if (typeof value === "string")
        return resolveText(value, scope, { legacy: true })
      if (Array.isArray(value)) return value.map(resolve)
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, resolve(v)])
        )
      return value
    }
    // Branch definitions are resolved only when their own step executes.
    const inputs = Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !["met", "notMet", "received", "timedOut"].includes(k))
        .map(([k, v]) => [k, k === "rules" ? v : resolve(v)])
    )
    if (node.type === "send_email")
      inputs.variables = Object.fromEntries(
        Object.entries(node.variables).map(([name, value]) => [
          name,
          resolveReference(value, scope, { legacy: true }),
        ])
      )
    if ("variables" in inputs && contact && node.type !== "send_email")
      inputs.variables = resolveVariables(
        inputs.variables as Parameters<typeof resolveVariables>[0],
        contact
      )
    const record = records.find((s) => s.key === key)
    if (record)
      await patchRow(ctx, "automationRunSteps", record._id, {
        inputs:
          node.type === "condition"
            ? {
                ...inputs,
                rules: node.rules.map((rule) => ({
                  ...rule,
                  field: rule.field,
                  actual: resolveReference(
                    rule.field.startsWith("{{")
                      ? rule.field
                      : `{{${rule.field}}}`,
                    scope
                  ),
                  value: resolveReference(rule.value, scope),
                })),
              }
            : inputs,
      })
    node = { ...node, ...inputs } as AutomationStep
    const output: Record<string, unknown> = {}
    switch (node.type) {
      case "place_call":
        return { output, waiting: true }
      case "delay": {
        const sleepMs = node.until
          ? Date.parse(String(node.until)) - Date.now()
          : parseDuration(String(node.duration))
        if (
          sleepMs === null ||
          !Number.isFinite(sleepMs) ||
          sleepMs < 0 ||
          sleepMs > 30 * 86400000
        )
          throw new ConvexError(
            "Delay must resolve to a future date or duration within 30 days"
          )
        return {
          output: { until: new Date(Date.now() + sleepMs).toISOString() },
          waiting: true,
          sleepMs,
        }
      }
      case "wait_for_event": {
        const duration = parseDuration(String(node.timeout))
        if (duration === null || duration < 0 || duration > 30 * 86400000)
          throw new ConvexError(
            "Event timeout must resolve to a duration within 30 days"
          )
        const deadline = Date.now() + duration
        await patchRow(ctx, "automationRuns", id, {
          waitingName: node.eventName,
          waitingKey: key,
          waitingAt: Date.now(),
          deadline,
        })
        await ctx.scheduler.runAt(
          deadline,
          internal.automationRuntime.timeout,
          { id, key }
        )
        return { output, waiting: true }
      }
      case "condition": {
        const checks = node.rules.map((rule) => evaluateRule(rule, scope))
        return {
          output: {
            condition_met:
              node.match === "and"
                ? checks.every(Boolean)
                : checks.some(Boolean),
            branch: (
              node.match === "and"
                ? checks.every(Boolean)
                : checks.some(Boolean)
            )
              ? "met"
              : "notMet",
          },
        }
      }
      case "contact_update": {
        if (!contact) throw new ConvexError("Contact not found")
        const patch: {
          firstName?: string
          lastName?: string
          unsubscribed?: boolean
          properties: Record<string, string>
        } = { properties: {} }
        for (const field of node.fields) {
          const value = field.action === "clear" ? "" : field.value
          if (field.property === "first_name") patch.firstName = String(value)
          else if (field.property === "last_name")
            patch.lastName = String(value)
          else if (field.property === "unsubscribed")
            patch.unsubscribed = String(value) === "true"
          else patch.properties[field.property] = String(value)
        }
        await updateContact(ctx, contact, patch)
        return {
          output: {
            contact: contactEventData(
              (await ctx.db.get("contacts", contact._id))!,
              await eventSegmentIds(ctx, contact._id)
            ),
          },
        }
      }
      case "contact_delete":
        if (contact) await deleteContact(ctx, contact)
        return { output: { deleted: !!contact } }
      case "add_to_segment": {
        if (!contact) throw new ConvexError("Contact not found")
        const segmentId = ctx.db.normalizeId("segments", node.segmentId)
        if (!segmentId) throw new ConvexError("Segment not found")
        await teamRow(ctx, "segments", run.organizationId, segmentId)
        await joinSegments(ctx, [contact], [segmentId])
        return { output: { segment_id: segmentId } }
      }
      case "send_messenger":
      case "send_instagram":
      case "send_whatsapp": {
        const channel = channelForSendStep(node.type)
        const basicReason =
          channel === "whatsapp"
            ? await recipientSkipReason(ctx, run, contact, null)
            : !contact || contact.organizationId !== run.organizationId
              ? "contact_deleted"
              : contact.unsubscribed
                ? "unsubscribed"
                : null
        if (basicReason)
          return { skipped: true, output: { reason: basicReason } }
        const target =
          channel === "whatsapp" && node.mode === "template"
            ? (await resolveWhatsAppSend(ctx, run.organizationId, {
                accountId: node.accountId,
                templateId: node.templateId!,
                variables: node.variables,
              }))!
            : null
        const account =
          target?.account ??
          (await resolveChannelAccount(
            ctx,
            run.organizationId,
            node.accountId,
            channel
          ))
        const reason = target
          ? await recipientSkipReason(
              ctx,
              run,
              contact,
              null,
              target.template,
              node.variables
            )
          : null
        if (reason) return { skipped: true, output: { reason } }
        // The eligibility check above establishes ownership before identity lookup.
        if (!contact)
          return { skipped: true, output: { reason: "contact_deleted" } }
        const pageIdentity =
          channel !== "whatsapp"
            ? await findPageIdentity(ctx, account, contact._id)
            : null
        if (channel !== "whatsapp" && !pageIdentity)
          return { skipped: true, output: { reason: "no_channel_identity" } }
        const to =
          channel === "whatsapp" ? contact.phone : pageIdentity!.externalId
        if (!to) return { skipped: true, output: { reason: "no_phone" } }
        if (channel !== "whatsapp" || node.mode === "text") {
          const identity =
            pageIdentity ??
            (await findWhatsAppIdentity(ctx, run.organizationId, to))
          const conversation = identity
            ? await ctx.db
                .query("conversations")
                .withIndex("by_accountId_and_channelContactId", (q) =>
                  q
                    .eq("accountId", account._id)
                    .eq("channelContactId", identity._id)
                )
                .unique()
            : null
          if ((conversation?.windowExpiresAt ?? 0) <= Date.now())
            return { skipped: true, output: { reason: "window_closed" } }
        }
        const messageId = await createChannelMessage(
          ctx,
          {
            channel,
            from: account._id,
            to,
            body:
              node.mode === "text"
                ? channel === "whatsapp"
                  ? { type: "text", text: { body: node.text } }
                  : { text: node.text }
                : {
                    type: "template",
                    template: {
                      id: node.templateId,
                      variables: resolveVariables(node.variables, contact),
                    },
                  },
          },
          {
            organizationId: run.organizationId,
            source: "automation",
            automationRunId: id,
          }
        )
        await patchRow(ctx, "automationRuns", id, { sent: run.sent + 1 })
        return { output: { message_id: messageId, status: "queued" } }
      }
      case "send_email": {
        if (!contact || contact.unsubscribed)
          return {
            skipped: true,
            output: { reason: contact ? "unsubscribed" : "contact_deleted" },
          }
        if (!contact.email)
          return {
            skipped: true,
            output: { reason: "no_email" },
          }
        const template = await publishedTemplate(
          ctx,
          run.organizationId,
          node.templateId
        )
        if (!template)
          throw new ConvexError("Template not found or not published")
        const values: Record<string, string | number> = Object.fromEntries(
          Object.entries(node.variables).map(([key, value]) => [
            key,
            typeof value === "number"
              ? value
              : value && typeof value === "object"
                ? JSON.stringify(value)
                : String(value),
          ])
        )
        for (const [key, value] of Object.entries(scope.contact))
          if (typeof value !== "object")
            values[`contact.${key}`] = String(value)
        for (const [key, value] of Object.entries(contact.properties)) {
          values[`contact.properties.${key}`] = value
          values[`contact.${key}`] = value
        }
        let headers: { name: string; value: string }[] = []
        if (
          template.html.includes(UNSUBSCRIBE_VARIABLE_NAME) ||
          template.subject.includes(UNSUBSCRIBE_VARIABLE_NAME)
        ) {
          const links = await unsubscribeLinks(ctx, {
            organizationId: run.organizationId,
            contactId: contact._id,
          })
          Object.assign(values, links.variables)
          headers = Object.entries(links.headers).map(([name, value]) => ({
            name,
            value,
          }))
        }
        // Template rendering must receive sender-filled values too (including
        // contact variables omitted from the template's editable variable list).
        const variables = [...template.variables]
        for (const name of Object.keys(values))
          if (!variables.some((item) => item.key === name))
            variables.push({ key: name })
        const rendered = renderTemplate(
          { ...template, variables },
          values as Record<string, string | number>
        )
        const replyTo = node.replyTo || template.replyTo || ""
        if (node.replyTo) {
          const mailbox = parseMailbox(node.replyTo)
          if (!mailbox) throw new ConvexError("Invalid reply-to address")
          const domain = await ctx.db
            .query("domains")
            .withIndex("by_organizationId_and_deleted_and_name", (q) =>
              q
                .eq("organizationId", run.organizationId)
                .eq("deleted", false)
                .eq("name", senderDomainOf(mailbox))
            )
            .first()
          if (!domain || domain.deleted || domain.status !== "verified")
            throw new ConvexError("Reply-to address must use a verified domain")
        }
        const emailId = await createEmail(
          ctx,
          {
            ...rendered,
            subject:
              node.subject !== undefined
                ? String(node.subject)
                : rendered.subject,
            from: node.from || template.from,
            to: [contact.email],
            cc: [],
            bcc: [],
            replyTo: replyTo ? [replyTo] : [],
            headers,
            attachments: [],
            tags: [],
          },
          { organizationId: run.organizationId, source: "automation" }
        )
        await patchRow(ctx, "automationRuns", id, { sent: run.sent + 1 })
        return {
          output: {
            message_id: emailId,
            email_id: emailId,
            status: "queued",
            to: contact.email,
          },
        }
      }
    }
    return { output }
  },
})
export const finishCall = internalMutation({
  args: { id: v.id("automationRuns"), key: v.string(), output: payloadValue },
  returns: v.boolean(),
  handler: async (ctx, { id, key, output }) => {
    const run = await active(ctx, id)
    if (!run) return false
    const record = await stepRow(ctx, run, key)
    if (record?.status === "running")
      await patchRow(ctx, "automationRunSteps", record._id, {
        status: output.status === "skipped" ? "skipped" : "completed",
        completedAt: Date.now(),
        output,
      })
    return true
  },
})
export const finishWait = internalMutation({
  args: { id: v.id("automationRuns"), key: v.string(), ...waitResult.fields },
  returns: v.boolean(),
  handler: async (ctx, { id, key, received, payload }) => {
    const run = await active(ctx, id)
    if (!run) return false
    const record = await stepRow(ctx, run, key)
    if (record && record.status === "running")
      await patchRow(ctx, "automationRunSteps", record._id, {
        status: "completed",
        completedAt: Date.now(),
        output:
          record.type === "wait_for_event"
            ? {
                ...record.output,
                event_received: received,
                ...(payload ? { ...payload, payload } : {}),
              }
            : record.output,
      })
    return true
  },
})
async function signal(
  ctx: MutationCtx,
  run: Doc<"automationRuns">,
  received: boolean,
  payload?: Record<string, unknown>,
  lastSignalEventId?: Id<"events">
) {
  if (!run.workflowId || !run.waitingKey || run.status !== "running") {
    if (lastSignalEventId)
      await patchRow(ctx, "automationRuns", run._id, { lastSignalEventId })
    return
  }
  await sendEvent(ctx, components.workflow, {
    workflowId: run.workflowId as WorkflowId,
    name: run.waitingKey,
    value: { received, ...(payload ? { payload } : {}) },
  })
  await patchRow(ctx, "automationRuns", run._id, {
    ...(lastSignalEventId ? { lastSignalEventId } : {}),
    waitingName: undefined,
    waitingKey: undefined,
    waitingAt: undefined,
    deadline: undefined,
  })
}
export const timeout = internalMutation({
  args: { id: v.id("automationRuns"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, key }): Promise<null> => {
    const run = await active(ctx, id)
    if (run?.waitingKey === key && run.deadline! <= Date.now())
      await signal(ctx, run, false)
    return null
  },
})
export const completed = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ id: v.id("automationRuns") }),
  },
  returns: v.null(),
  handler: async (ctx, { context, result, workflowId }): Promise<null> => {
    const run = await ctx.db.get("automationRuns", context.id)
    if (!run || (await retirement(ctx, run.organizationId))) {
      await cleanup(ctx, components.workflow, workflowId)
      return null
    }
    if (run?.status === "running") {
      const status =
        result.kind === "success"
          ? "completed"
          : result.kind === "canceled"
            ? "cancelled"
            : "failed"
      await patchRow(ctx, "automationRuns", run._id, {
        status,
        workflowId: undefined,
        completedAt: Date.now(),
        waitingName: undefined,
        waitingKey: undefined,
        deadline: undefined,
        waitingAt: undefined,
      })
      const steps = await ctx.db
        .query("automationRunSteps")
        .withIndex("by_organizationId_and_runId_and_key", (q) =>
          q.eq("organizationId", run.organizationId).eq("runId", run._id)
        )
        .take(101)
      for (const record of steps)
        if (record.status === "running")
          await patchRow(ctx, "automationRunSteps", record._id, {
            status,
            completedAt: Date.now(),
            ...(result.kind === "failed" ? { error: result.error } : {}),
          })
    }
    await cleanup(ctx, components.workflow, workflowId)
    if (run.status !== "running")
      await patchRow(ctx, "automationRuns", run._id, { workflowId: undefined })
    return null
  },
})
export async function stopRun(ctx: MutationCtx, run: Doc<"automationRuns">) {
  if (run.status !== "running") return
  await patchRow(ctx, "automationRuns", run._id, {
    status: "cancelled",
    completedAt: Date.now(),
    waitingName: undefined,
    waitingKey: undefined,
    waitingAt: undefined,
    deadline: undefined,
  })
  const steps = await ctx.db
    .query("automationRunSteps")
    .withIndex("by_organizationId_and_runId_and_key", (q) =>
      q.eq("organizationId", run.organizationId).eq("runId", run._id)
    )
    .take(101)
  for (const record of steps)
    if (record.status === "running")
      await patchRow(ctx, "automationRunSteps", record._id, {
        status: "cancelled",
        completedAt: Date.now(),
      })
  if (run.workflowId)
    await cancel(ctx, components.workflow, run.workflowId as WorkflowId)
}

export const consume = internalMutation({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const event = await ctx.db.get("events", id)
    if (
      !event ||
      (customEventName(event.type) === null &&
        !SYSTEM_EVENT_CATALOG.some((e) => e.name === event.type))
    )
      return null
    await ctx.scheduler.runAfter(0, internal.automationRuntime.dispatch, {
      id,
      phase: "wait",
      cursor: null,
    })
    return null
  },
})
export const dispatch = internalMutation({
  args: {
    id: v.id("events"),
    phase: v.union(v.literal("wait"), v.literal("start")),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { id, phase, cursor }): Promise<null> => {
    const event = await ctx.db.get("events", id)
    if (!event || (await retirement(ctx, event.organizationId))) return null
    const custom = customEventName(event.type)
    const name =
      custom ??
      SYSTEM_EVENT_CATALOG.find((e) => e.name === event.type)?.trigger ??
      null
    if (name === null) return null
    const data = event.data
    const contactId =
      typeof data.contact_id === "string"
        ? ctx.db.normalizeId("contacts", data.contact_id)
        : event.type.startsWith("contact.") && typeof data.id === "string"
          ? ctx.db.normalizeId("contacts", data.id)
          : null
    let contact = contactId ? await ctx.db.get("contacts", contactId) : null
    if (contact && contact.organizationId !== event.organizationId) return null
    // A known contact id remains authoritative after deletion. System events
    // can still run without a contact; neither lookup nor upsert may replace it.
    if (contactId && !contact && custom !== null) return null
    if (!contactId && !contact && typeof data.email === "string")
      contact = await ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_email", (q) =>
          q
            .eq("organizationId", event.organizationId)
            .eq("email", data.email as string)
        )
        .unique()
    const payload =
      custom !== null ? (data.payload as Record<string, unknown>) : data
    if (phase === "wait") {
      {
        const page = await ctx.db
          .query("automationRuns")
          .withIndex("by_organizationId_and_contactId_and_waitingName", (q) =>
            q
              .eq("organizationId", event.organizationId)
              .eq("contactId", contact?._id)
              .eq("waitingName", name)
          )
          .paginate({ numItems: BATCH, cursor })
        for (const run of page.page) {
          if (
            run.lastSignalEventId !== id &&
            event._creationTime >= run.waitingAt! &&
            event._creationTime <= run.deadline!
          ) {
            await signal(ctx, run, true, payload, id)
          }
        }
        if (!page.isDone) {
          await ctx.scheduler.runAfter(0, internal.automationRuntime.dispatch, {
            id,
            phase,
            cursor: page.continueCursor,
          })
          return null
        }
      }
      await ctx.scheduler.runAfter(0, internal.automationRuntime.dispatch, {
        id,
        phase: "start",
        cursor: null,
      })
      return null
    }
    const page = await ctx.db
      .query("automations")
      .withIndex("by_organizationId_and_trigger_and_status", (q) =>
        q
          .eq("organizationId", event.organizationId)
          .eq("trigger", name)
          .eq("status", "enabled")
      )
      .paginate({ numItems: BATCH, cursor })
    for (const automation of page.page) {
      if (
        automation.deleted ||
        (automation.enabledAt ?? automation._creationTime) > event._creationTime
      )
        continue
      if (!contactId && !contact && typeof data.email === "string") {
        const made = await upsertContact(
          ctx,
          event.organizationId,
          { email: data.email },
          {
            properties: await listProperties(ctx, event.organizationId),
            segmentIds: [],
            skipExisting: true,
          }
        )
        contact = await ctx.db.get("contacts", made.id)
      }
      const filterContact = contact
        ? contactEventData(contact, await eventSegmentIds(ctx, contact._id))
        : {}
      if (
        automation.triggerFilters?.length &&
        !automation.triggerFilters.every((rule) =>
          evaluateRule(rule, {
            trigger: payload,
            event: payload,
            contact: filterContact,
          })
        )
      )
        continue
      if (contact || custom === null)
        await startRun(ctx, automation, contact, payload, id)
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.automationRuntime.dispatch, {
        id,
        phase,
        cursor: page.continueCursor,
      })
    return null
  },
})
export const purge = internalMutation({
  args: { organizationId: v.string(), id: v.id("automations") },
  returns: v.null(),
  handler: async (ctx, { organizationId, id }): Promise<null> => {
    const automation = await ctx.db.get("automations", id)
    if (!automation?.deleted || automation.organizationId !== organizationId)
      return null
    // One run per transaction bounds even a maximal graph's cleanup.
    const run = await ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", organizationId).eq("automationId", id)
      )
      .first()
    if (run) {
      await stopRun(ctx, run)
      if (run.workflowId)
        await cleanup(ctx, components.workflow, run.workflowId as WorkflowId)
      const steps = await ctx.db
        .query("automationRunSteps")
        .withIndex("by_organizationId_and_runId_and_key", (q) =>
          q.eq("organizationId", organizationId).eq("runId", run._id)
        )
        .take(101)
      for (const record of steps)
        await deleteRow(ctx, "automationRunSteps", record._id)
      await deleteRow(ctx, "automationRuns", run._id)
      await ctx.scheduler.runAfter(0, internal.automationRuntime.purge, {
        organizationId,
        id,
      })
    } else await deleteRow(ctx, "automations", id)
    return null
  },
})
