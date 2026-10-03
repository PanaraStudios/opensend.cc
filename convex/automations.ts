import { ownedBot } from "./voice/resources"
import { own as ownedIvr } from "./ivr/definitions"
import {
  outboundRoute,
  callContext,
  outboundInstructions,
} from "../lib/calling/outbound"
import { referenceErrors } from "../lib/automation-references"
import { catalogContactSchema } from "../lib/event-catalog"
import { teamEventCatalog } from "./automationEvents"
import { triggerFiltersValue } from "./tables/automations"
import { pageChannelValue } from "./tables/channels"
import { isChannelSendStep, channelForSendStep } from "../lib/channels"
import { localTemplateDefinition } from "./channels/templates"
import { ConvexError, v } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import { counters, countValue, insertRow, patchRow } from "./counts"
import { matchesSearch, teamPage, teamRow } from "./lists"
import { defineEvent, findEvent, payloadShapeError } from "./automationEvents"
import { startRun, stopRun } from "./automationRuntime"
import { readGraph } from "./automationDefinition"
import { resolveChannelAccount } from "./channels/messages"
import { resolveWhatsAppSend } from "./broadcastWhatsApp"
import { publishedTemplate, templateOptions } from "./templates"
import {
  automationStatus,
  payloadValue,
  runStatus,
  stepType,
} from "./tables/automations"
import schema from "./schema"
import {
  automationTasks,
  eventNameError,
  triggerEventError,
  flattenSteps,
  payloadErrors,
  UNTITLED_AUTOMATION,
} from "../lib/dashboard/automation"

const scope = { organizationId: v.string(), id: v.id("automations") }
export async function ownedAutomation(
  ctx: QueryCtx,
  organizationId: string,
  id: Id<"automations">
) {
  const row = await ctx.db.get("automations", id)
  if (!row || row.organizationId !== organizationId || row.deleted)
    throw new ConvexError("Automation not found or permission denied")
  return row
}
const filters = {
  organizationId: v.string(),
  search: v.optional(v.string()),
  status: v.optional(automationStatus),
}
// Definitions are small documents with no hydration per match.
export const AUTOMATION_SEARCH_BUDGET = { rows: 512, bytes: 4 * 1024 * 1024 }

export const list = query({
  args: { ...filters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    schema.doc("automations").extend({ runs: v.number() })
  ),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const result = await teamPage(
      ctx,
      "automations",
      args.organizationId,
      args.paginationOpts,
      (row) =>
        !row.deleted &&
        (!args.status || row.status === args.status) &&
        matchesSearch(args.search)(row.name, row.trigger),
      AUTOMATION_SEARCH_BUDGET,
      args.search
    )
    const counts = await counters.automationRuns.totals(
      ctx,
      result.page.map((row) => row._id)
    )
    return {
      ...result,
      page: result.page.map((row, i) => ({ ...row, runs: counts[i]! })),
    }
  },
})
export const count = query({
  args: filters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return {
      total: args.search?.trim()
        ? null
        : await counters.automations.total(ctx, args.organizationId, [
            { is: args.status, among: ["enabled", "disabled"] },
          ]),
    }
  },
})
export const get = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.union(v.null(), schema.doc("automations")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return teamRow(ctx, "automations", args.organizationId, args.id, {
      keep: (row) => !row.deleted,
    })
  },
})
export async function createAutomation(
  ctx: MutationCtx,
  organizationId: string
) {
  return insertRow(ctx, "automations", {
    organizationId,
    name: UNTITLED_AUTOMATION,
    trigger: "",
    graph: "[]",
    status: "disabled",
    deleted: false,
    updatedAt: Date.now(),
  })
}
export const create = mutation({
  args: { organizationId: v.string() },
  returns: v.id("automations"),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "write")
    return createAutomation(ctx, organizationId)
  },
})
async function ensureNames(
  ctx: MutationCtx,
  organizationId: string,
  trigger: string,
  graph: string,
  id: Id<"automations">
) {
  const existing = await ctx.db
    .query("automationEventLinks")
    .withIndex("by_organizationId_and_automationId", (q) =>
      q.eq("organizationId", organizationId).eq("automationId", id)
    )
    .take(101)
  for (const link of existing)
    await ctx.db.delete("automationEventLinks", link._id)
  const names = new Set([
    trigger,
    ...flattenSteps(readGraph(graph)).flatMap((step) =>
      step.type === "wait_for_event" ? [step.eventName] : []
    ),
  ])
  for (const name of names) {
    if (eventNameError(name)) continue
    await ctx.db.insert("automationEventLinks", {
      organizationId,
      automationId: id,
      name,
    })
    if (!(await findEvent(ctx, organizationId, name)))
      await defineEvent(ctx, organizationId, { name, schema: [] })
  }
}
export async function updateAutomation(
  ctx: MutationCtx,
  organizationId: string,
  id: Id<"automations">,
  patch: {
    name?: string
    trigger?: string
    graph?: string
    triggerFilters?: import("../lib/dashboard/types").AutomationRule[]
  }
) {
  const row = await ownedAutomation(ctx, organizationId, id)
  if (
    row.status === "enabled" &&
    (patch.graph !== undefined ||
      patch.trigger !== undefined ||
      patch.triggerFilters !== undefined)
  )
    throw new ConvexError("An enabled automation cannot be edited")
  if (patch.graph !== undefined) readGraph(patch.graph)
  if (patch.name !== undefined) {
    patch.name = patch.name.trim() || UNTITLED_AUTOMATION
    if (patch.name.length > 256)
      throw new ConvexError("Automation name is too long")
  }
  if (patch.trigger !== undefined) {
    patch.trigger = patch.trigger.trim()
    const error = patch.trigger && triggerEventError(patch.trigger)
    if (error) throw new ConvexError(error)
  }
  const catalog = await teamEventCatalog(ctx, organizationId)
  const contactSchema = catalogContactSchema(catalog)
  const problems = referenceErrors(
    patch.trigger ?? row.trigger,
    readGraph(patch.graph ?? row.graph),
    catalog,
    contactSchema,
    patch.triggerFilters ?? row.triggerFilters ?? []
  )
  if (problems.length) throw new ConvexError(problems.join("; "))
  await ensureNames(
    ctx,
    organizationId,
    patch.trigger ?? row.trigger,
    patch.graph ?? row.graph,
    id
  )
  await patchRow(ctx, "automations", id, {
    ...patch,
    ...(patch.graph !== undefined || patch.trigger !== undefined
      ? { apiDefinition: undefined }
      : {}),
    updatedAt: Date.now(),
  })
  return null
}
export const update = mutation({
  args: {
    ...scope,
    name: v.optional(v.string()),
    trigger: v.optional(v.string()),
    triggerFilters: v.optional(triggerFiltersValue),
    graph: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { organizationId, id, ...patch }) => {
    await requireTeam(ctx, organizationId, "write")
    return updateAutomation(ctx, organizationId, id, patch)
  },
})
export async function setAutomationStatus(
  ctx: MutationCtx,
  organizationId: string,
  id: Id<"automations">,
  status: "enabled" | "disabled"
) {
  const row = await ownedAutomation(ctx, organizationId, id)
  if (status === "enabled") {
    const catalog = await teamEventCatalog(ctx, organizationId)
    const contactSchema = catalogContactSchema(catalog)
    const referenceProblems = referenceErrors(
      row.trigger,
      readGraph(row.graph),
      catalog,
      contactSchema,
      row.triggerFilters ?? []
    )
    if (referenceProblems.length)
      throw new ConvexError(referenceProblems.join("; "))
    const steps = readGraph(row.graph)
    const templates = []
    const segments = []
    for (const step of flattenSteps(steps)) {
      if (
        "accountId" in step &&
        step.type !== "place_call" &&
        isChannelSendStep(step.type) &&
        step.accountId
      ) {
        const channel = channelForSendStep(step.type)
        if (
          channel === "whatsapp" &&
          step.mode === "template" &&
          step.templateId
        )
          await resolveWhatsAppSend(ctx, organizationId, {
            accountId: step.accountId,
            templateId: step.templateId,
            variables: step.variables,
          })
        else
          await resolveChannelAccount(
            ctx,
            organizationId,
            step.accountId,
            channel
          )
        if (
          channel !== "whatsapp" &&
          step.mode === "template" &&
          step.templateId
        ) {
          const { published } = await localTemplateDefinition(
            ctx,
            organizationId,
            channel,
            { id: step.templateId }
          )
          if (
            published.variables.some(
              (variable) =>
                step.variables[variable.key] === undefined &&
                variable.fallback === undefined
            )
          )
            throw new ConvexError("Map every template variable before sending")
        }
      }
      if (step.type === "place_call" && step.accountId && step.route) {
        await resolveChannelAccount(
          ctx,
          organizationId,
          step.accountId,
          "whatsapp"
        )
        const route = outboundRoute(step.route)
        callContext({ context: step.purpose, variables: step.variables })
        if (route?.kind === "bot") {
          const bot = await ownedBot(ctx, organizationId, route.botId)
          outboundInstructions(bot.systemPrompt, step.purpose, step.variables)
        } else if (route?.kind === "ivr")
          await ownedIvr(ctx, organizationId, route.ivrId)
        else throw new ConvexError("Select a bot or IVR")
      }
      if (step.type === "send_email") {
        const template = await publishedTemplate(
          ctx,
          organizationId,
          step.templateId
        )
        if (template)
          templates.push({
            id: template.id,
            name: template.name,
            status: "published" as const,
          })
      }
      if (step.type === "add_to_segment") {
        const sid = ctx.db.normalizeId("segments", step.segmentId)
        const segment = sid ? await ctx.db.get("segments", sid) : null
        if (segment?.organizationId === organizationId)
          segments.push({ id: segment._id, name: segment.name })
      }
    }
    const tasks = automationTasks(
      { trigger: row.trigger, steps },
      { templates, segments }
    )
    if (tasks.length) return tasks
  }
  await patchRow(ctx, "automations", id, {
    status,
    updatedAt: Date.now(),
    ...(status === "enabled" && row.status !== "enabled"
      ? { enabledAt: Date.now() }
      : {}),
  })
  return []
}
export const setStatus = mutation({
  args: { ...scope, status: automationStatus },
  returns: v.array(
    v.object({
      key: v.string(),
      type: stepType,
      title: v.string(),
      tasks: v.array(v.string()),
    })
  ),
  handler: async (ctx, { organizationId, id, status }) => {
    await requireTeam(ctx, organizationId, "write")
    return setAutomationStatus(ctx, organizationId, id, status)
  },
})
export async function duplicateAutomation(
  ctx: MutationCtx,
  organizationId: string,
  id: Id<"automations">
) {
  const row = await ownedAutomation(ctx, organizationId, id)
  const copy = await insertRow(ctx, "automations", {
    organizationId,
    name: `${row.name} copy`,
    graph: row.graph,
    apiDefinition: row.apiDefinition,
    trigger: row.trigger,
    status: "disabled",
    deleted: false,
    updatedAt: Date.now(),
  })
  await ensureNames(ctx, organizationId, row.trigger, row.graph, copy)
  return copy
}
export const duplicate = mutation({
  args: scope,
  returns: v.id("automations"),
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId, "write")
    return duplicateAutomation(ctx, organizationId, id)
  },
})
export async function removeAutomation(
  ctx: MutationCtx,
  organizationId: string,
  id: Id<"automations">
) {
  await ownedAutomation(ctx, organizationId, id)
  // The tombstone fences every step before the bounded cleanup reaches it.
  const links = await ctx.db
    .query("automationEventLinks")
    .withIndex("by_organizationId_and_automationId", (q) =>
      q.eq("organizationId", organizationId).eq("automationId", id)
    )
    .take(101)
  for (const link of links)
    await ctx.db.delete("automationEventLinks", link._id)
  await patchRow(ctx, "automations", id, {
    deleted: true,
    status: "disabled",
    updatedAt: Date.now(),
  })
  await ctx.scheduler.runAfter(0, internal.automationRuntime.purge, {
    organizationId,
    id,
  })
  return null
}
export const remove = mutation({
  args: scope,
  returns: v.null(),
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId, "write")
    return removeAutomation(ctx, organizationId, id)
  },
})
export const test = mutation({
  args: { ...scope, contactId: v.id("contacts"), payload: payloadValue },
  returns: v.id("automationRuns"),
  handler: async (
    ctx,
    { organizationId, id, contactId, payload }
  ): Promise<Id<"automationRuns">> => {
    await requireTeam(ctx, organizationId, "write")
    const row = await ownedAutomation(ctx, organizationId, id)
    if (row.status !== "enabled")
      throw new ConvexError("Start the automation before testing it.")
    const contact = await ctx.db.get("contacts", contactId)
    if (!contact || contact.organizationId !== organizationId)
      throw new ConvexError("Contact not found or permission denied")
    const definition = await findEvent(ctx, organizationId, row.trigger)
    const error =
      payloadShapeError(payload) ??
      payloadErrors(definition ?? undefined, payload)[0]
    if (error) throw new ConvexError(error)
    return startRun(ctx, row, contact, payload)
  },
})
const runFilters = {
  ...scope,
  status: v.optional(runStatus),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
}
export const runs = query({
  args: { ...runFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("automationRuns")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    await ownedAutomation(ctx, args.organizationId, args.id)
    const page = await ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) => {
        const base = q
          .eq("organizationId", args.organizationId)
          .eq("automationId", args.id)
        if (args.from !== undefined && args.to !== undefined)
          return base
            .gte("_creationTime", args.from)
            .lte("_creationTime", args.to)
        if (args.from !== undefined) return base.gte("_creationTime", args.from)
        if (args.to !== undefined) return base.lte("_creationTime", args.to)
        return base
      })
      .order("desc")
      .paginate(args.paginationOpts)
    return {
      ...page,
      page: page.page.filter(
        (row) => !args.status || row.status === args.status
      ),
    }
  },
})
export const runCount = query({
  args: runFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    await ownedAutomation(ctx, args.organizationId, args.id)
    return {
      total: (await runTotals(ctx, args.id, args)).reduce(
        (sum, n) => sum + n,
        0
      ),
    }
  },
})
export const runSteps = query({
  args: { organizationId: v.string(), runId: v.id("automationRuns") },
  returns: v.array(schema.doc("automationRunSteps")),
  handler: async (ctx, { organizationId, runId }) => {
    await requireTeam(ctx, organizationId)
    const run = await ctx.db.get("automationRuns", runId)
    if (!run || run.organizationId !== organizationId)
      throw new ConvexError("Run not found or permission denied")
    await ownedAutomation(ctx, organizationId, run.automationId)
    // A definition has at most 100 steps plus its trigger.
    return ctx.db
      .query("automationRunSteps")
      .withIndex("by_organizationId_and_runId_and_key", (q) =>
        q.eq("organizationId", organizationId).eq("runId", runId)
      )
      .take(101)
  },
})
export const cancelRun = mutation({
  args: { organizationId: v.string(), runId: v.id("automationRuns") },
  returns: v.null(),
  handler: async (ctx, { organizationId, runId }): Promise<null> => {
    await requireTeam(ctx, organizationId, "write")
    const run = await ctx.db.get("automationRuns", runId)
    if (!run || run.organizationId !== organizationId)
      throw new ConvexError("Run not found or permission denied")
    await stopRun(ctx, run)
    return null
  },
})

const RUN_STATUSES = ["running", "completed", "failed", "cancelled"] as const
function timeBounds(prefix: string[], from?: number, to?: number) {
  return {
    lower: { key: [...prefix, from ?? 0], inclusive: true },
    upper: { key: [...prefix, to ?? Number.MAX_SAFE_INTEGER], inclusive: true },
  }
}
async function runTotals(
  ctx: QueryCtx,
  id: Id<"automations">,
  args: { status?: (typeof RUN_STATUSES)[number]; from?: number; to?: number }
) {
  return counters.automationRuns.aggregate.countBatch(
    ctx,
    (args.status ? [args.status] : RUN_STATUSES).map((status) => ({
      namespace: id,
      bounds: timeBounds([status], args.from, args.to),
    })) as never
  )
}
export const metrics = query({
  args: { ...scope, from: v.optional(v.number()), to: v.optional(v.number()) },
  returns: v.object({
    total: v.number(),
    sent: v.number(),
    rates: v.record(v.string(), v.number()),
    steps: v.array(
      v.object({
        key: v.string(),
        executions: v.number(),
        averageMs: v.union(v.number(), v.null()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const automation = await ownedAutomation(ctx, args.organizationId, args.id)
    const counts = await runTotals(ctx, args.id, args)
    const total = counts.reduce((sum, n) => sum + n, 0)
    const sent = (
      await counters.automationRuns.aggregate.sumBatch(
        ctx,
        RUN_STATUSES.map((status) => ({
          namespace: args.id,
          bounds: timeBounds([status], args.from, args.to),
        })) as never
      )
    ).reduce((sum, n) => sum + n, 0)
    const keys = [
      "start",
      ...flattenSteps(readGraph(automation.graph)).map((step) => step.key),
    ]
    const statuses = [...RUN_STATUSES, "skipped"]
    const options = keys.flatMap((key) =>
      statuses.map((status) => ({
        namespace: args.id,
        bounds: timeBounds([key, status], args.from, args.to),
      }))
    )
    const executions = await counters.automationRunSteps.aggregate.countBatch(
      ctx,
      options as never
    )
    const durations = await counters.automationRunSteps.aggregate.sumBatch(
      ctx,
      options as never
    )
    return {
      total,
      sent,
      rates: Object.fromEntries(
        RUN_STATUSES.map((status, i) => [
          status,
          total ? Math.round((counts[i]! / total) * 100) : 0,
        ])
      ),
      steps: keys.map((key, i) => {
        const slice = executions.slice(
          i * statuses.length,
          (i + 1) * statuses.length
        )
        const finished = slice.slice(1).reduce((sum, n) => sum + n, 0)
        const elapsed = durations
          .slice(i * statuses.length, (i + 1) * statuses.length)
          .reduce((sum, n) => sum + n, 0)
        return {
          key,
          executions: slice.reduce((sum, n) => sum + n, 0),
          averageMs: finished ? elapsed / finished : null,
        }
      }),
    }
  },
})

export const usesEvent = query({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { organizationId, name }) => {
    await requireTeam(ctx, organizationId)
    return !!(await ctx.db
      .query("automationEventLinks")
      .withIndex("by_organizationId_and_name", (q) =>
        q.eq("organizationId", organizationId).eq("name", name)
      )
      .first())
  },
})

export const stepContext = query({
  args: {
    organizationId: v.string(),
    templateIds: v.array(v.string()),
    segmentIds: v.array(v.string()),
  },
  returns: v.object({
    templates: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        status: v.union(v.literal("draft"), v.literal("published")),
      })
    ),
    segments: v.array(v.object({ id: v.string(), name: v.string() })),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "read")
    if (args.templateIds.length + args.segmentIds.length > 100)
      throw new ConvexError("Too many step references")
    const templates = []
    for (const value of new Set(args.templateIds)) {
      const id = ctx.db.normalizeId("templates", value)
      const row = id ? await ctx.db.get("templates", id) : null
      if (row && row.organizationId === args.organizationId)
        templates.push({ id: row._id, name: row.name, status: row.status })
    }
    const segments = []
    for (const value of new Set(args.segmentIds)) {
      const id = ctx.db.normalizeId("segments", value)
      const row = id ? await ctx.db.get("segments", id) : null
      if (row && row.organizationId === args.organizationId)
        segments.push({ id: row._id, name: row.name })
    }
    return { templates, segments }
  },
})

/** Page send steps use only their channel's connected accounts and published templates. */
export const channelOptions = query({
  args: {
    organizationId: v.string(),
    channel: pageChannelValue,
    accountId: v.optional(v.string()),
    templateId: v.optional(v.string()),
    accountSearch: v.optional(v.string()),
    templateSearch: v.optional(v.string()),
  },
  returns: v.object({
    accounts: v.array(
      v.object({ id: v.id("channelAccounts"), name: v.string() })
    ),
    templates: v.array(v.object({ id: v.id("templates"), name: v.string() })),
    selected: v.union(
      v.null(),
      v.object({ components: v.any(), variables: v.array(v.string()) })
    ),
  }),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const rows = await ctx.db
      .query("channelAccounts")
      .withIndex("by_organizationId_and_channel_and_disconnectedAt", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("channel", args.channel)
          .eq("disconnectedAt", undefined)
      )
      .take(200)
    const active = []
    for (const row of rows) {
      try {
        await resolveChannelAccount(
          ctx,
          args.organizationId,
          row._id,
          args.channel
        )
        active.push(row)
      } catch {
        /* The picker follows the pipeline's sendability rules. */
      }
    }
    const account = active.find((row) => row._id === args.accountId)
    const templates = account
      ? await templateOptions(ctx, {
          organizationId: args.organizationId,
          channel: args.channel,
          publishedOnly: true,
          search: args.templateSearch,
          selectedId:
            ctx.db.normalizeId("templates", args.templateId ?? "") ?? undefined,
        })
      : []
    let selected = null
    if (templates.some((row) => row._id === args.templateId)) {
      const { published } = await localTemplateDefinition(
        ctx,
        args.organizationId,
        args.channel,
        { id: args.templateId }
      )
      selected = {
        components: published.components,
        variables: published.variables.map((variable) => variable.key),
      }
    }
    const matches = matchesSearch(args.accountSearch)
    return {
      accounts: active
        .filter(
          (row) =>
            row._id === args.accountId || matches(row.displayName, row.handle)
        )
        .map((row) => ({
          id: row._id,
          name: `${row.displayName} (${row.handle})`,
        })),
      templates: templates.map((row) => ({ id: row._id, name: row.name })),
      selected,
    }
  },
})
