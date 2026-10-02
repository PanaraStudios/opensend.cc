import { eventCatalog } from "../lib/event-catalog"
import { listProperties } from "./audience"
import { includeSelected } from "../lib/dashboard/options"
import { selectedOption, prefixOptions } from "./lists"
import { stream } from "convex-helpers/server/stream"
import { v, ConvexError, convexToJson, type Value } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import { emitEvent } from "./events"
import {
  deleteAutomationEvent,
  insertAutomationEvent,
  patchAutomationEvent,
} from "./automationEventRows"
import {
  deleteOccurrence,
  insertOccurrence,
} from "./automationEventOccurrenceRows"
import { eventSchemaValue } from "./tables/automationEvents"
import {
  cleanSchema,
  eventNameError,
  payloadErrors,
  schemaError,
} from "../lib/dashboard/automation"
import { filteredPage, matchesSearch } from "./lists"
import type { AutomationEvent } from "../lib/dashboard/types"

/** A flat payload rarely has more than a few dozen fields, and every send
    is checked against each one; the form shows one row per property. */
export const MAX_SCHEMA_KEYS = 50
const MAX_NAME = 256
/** Far below Convex's 1 MiB value limit: the payload is stored with the
    occurrence and again on the outbox event. */
export const MAX_PAYLOAD_BYTES = 64 * 1024
/** Leaves room under Convex's nesting limit for the documents it sits in. */
const MAX_PAYLOAD_DEPTH = 32
/** Resend documents no retention for sent events; ours matches its logs. */
const RETENTION = 30 * 24 * 3_600_000
const BATCH = 200
/** Names one automation can mention: its trigger and its waits. */
const ENSURE_LIMIT = 100

/** Custom events ride the outbox under this prefix, which no system event
    type has: a custom event named `email.sent` is never taken for the real
    one, and webhooks, which subscribe only to system types, never get it.
    Consumers read the name back with `customEventName`. */
export const CUSTOM_EVENT_PREFIX = "custom:"
export const customEventType = (name: string) => CUSTOM_EVENT_PREFIX + name
export const customEventName = (type: string) =>
  type.startsWith(CUSTOM_EVENT_PREFIX)
    ? type.slice(CUSTOM_EVENT_PREFIX.length)
    : null

type Schema = AutomationEvent["schema"]

export const findEvent = (
  ctx: QueryCtx,
  organizationId: string,
  name: string
) =>
  ctx.db
    .query("automationEvents")
    .withIndex("by_organizationId_and_name", (q) =>
      q.eq("organizationId", organizationId).eq("name", name)
    )
    .first()

/** The name as stored, or throw why it cannot be one. */
function checkedName(name: string, taken: readonly string[] = []) {
  const problem = eventNameError(name, taken)
  if (problem) throw new ConvexError(problem)
  const trimmed = name.trim()
  if (trimmed.length > MAX_NAME)
    throw new ConvexError(`Event names are limited to ${MAX_NAME} characters`)
  return trimmed
}
function checkedSchema(fields: Schema) {
  const problem = schemaError(fields)
  if (problem) throw new ConvexError(problem)
  const cleaned = cleanSchema(fields)
  if (cleaned.length > MAX_SCHEMA_KEYS)
    throw new ConvexError(
      `An event can have up to ${MAX_SCHEMA_KEYS} properties`
    )
  return cleaned
}
/** The name, if no other event of the team has it. */
async function freeName(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  self?: Id<"automationEvents">
) {
  const trimmed = checkedName(name)
  const existing = await findEvent(ctx, organizationId, trimmed)
  if (existing && existing._id !== self)
    throw new ConvexError(eventNameError(trimmed, [trimmed])!)
  return trimmed
}

/* The rules for definitions, shared by the dashboard and the REST API. */
export async function defineEvent(
  ctx: MutationCtx,
  organizationId: string,
  input: { name: string; schema: Schema }
) {
  const schema = checkedSchema(input.schema)
  return insertAutomationEvent(ctx, organizationId, {
    name: await freeName(ctx, organizationId, input.name),
    schema,
  })
}
export async function changeEvent(
  ctx: MutationCtx,
  event: Doc<"automationEvents">,
  input: { name?: string; schema?: Schema }
) {
  if (input.name !== undefined && input.name.trim() !== event.name) {
    const used = await ctx.db
      .query("automationEventLinks")
      .withIndex("by_organizationId_and_name", (q) =>
        q.eq("organizationId", event.organizationId).eq("name", event.name)
      )
      .first()
    if (used)
      throw new ConvexError("An event used by automations cannot be renamed")
  }
  await patchAutomationEvent(ctx, event, {
    ...(input.schema === undefined
      ? {}
      : { schema: checkedSchema(input.schema) }),
    ...(input.name === undefined
      ? {}
      : {
          name: await freeName(
            ctx,
            event.organizationId,
            input.name,
            event._id
          ),
        }),
  })
}

/** Why a sent payload cannot be kept, or null. Checked before it reaches a
    mutation, whose argument checks would fail it as a server error. */
export function payloadShapeError(payload: Record<string, unknown>) {
  const depth = (value: unknown): number =>
    value && typeof value === "object"
      ? 1 + Math.max(0, ...Object.values(value).map(depth))
      : 0
  try {
    if (depth(payload) > MAX_PAYLOAD_DEPTH)
      return `The \`payload\` is nested more than ${MAX_PAYLOAD_DEPTH} levels deep.`
    const size = new TextEncoder().encode(
      JSON.stringify(convexToJson(payload as Value))
    ).length
    return size > MAX_PAYLOAD_BYTES
      ? `The \`payload\` is limited to ${MAX_PAYLOAD_BYTES / 1024} KB.`
      : null
  } catch (error) {
    return `The \`payload\` cannot be stored: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Stores one sent event and puts it on the outbox. A defined event's
    payload must match its schema; an event nobody defined is taken as it
    is, as Resend does. The caller has identified the contact. */
export async function receiveEvent(
  ctx: MutationCtx,
  organizationId: string,
  input: {
    name: string
    contact: Doc<"contacts"> | null
    /** Normalized; only when there is no contact yet. */
    email?: string
    payload: Record<string, unknown>
  }
) {
  const name = checkedName(input.name)
  const definition = await findEvent(ctx, organizationId, name)
  const errors = payloadErrors(definition ?? undefined, input.payload)
  if (errors.length > 0)
    throw new ConvexError(
      `The payload does not match the ${name} event: ${errors.join(", ")}.`
    )
  const email = input.contact?.email ?? input.email
  const id = await insertOccurrence(ctx, {
    organizationId,
    name,
    ...(input.contact ? { contactId: input.contact._id } : {}),
    ...(email ? { email } : {}),
    payload: input.payload,
  })
  await emitEvent(ctx, organizationId, customEventType(name), {
    id,
    event: name,
    contact_id: input.contact?._id ?? null,
    email: email ?? null,
    payload: input.payload,
  })
  return id
}

async function writableEvent(ctx: MutationCtx, id: Id<"automationEvents">) {
  const event = await ctx.db.get("automationEvents", id)
  if (!event) throw new ConvexError("Event not found")
  await requireTeam(ctx, event.organizationId, "write")
  return event
}

// 512 definitions, no hydration; schema keys are already in the scanned document.
export const EVENT_SEARCH_BUDGET = { rows: 512, bytes: 4 * 1024 * 1024 }

/** Newest first; substring search filters each bounded index page. */
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  returns: paginationResultValidator(schema.doc("automationEvents")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const matches = matchesSearch(args.search)
    return filteredPage(
      stream(ctx.db, schema)
        .query("automationEvents")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .order("desc"),
      args.paginationOpts,
      (row) => matches(row.searchText, ...row.schema.map((field) => field.key)),
      EVENT_SEARCH_BUDGET,
      args.search
    )
  },
})

/** One event of the team by its name, or null. */
export const byName = query({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.union(v.null(), schema.doc("automationEvents")),
  handler: async (ctx, { organizationId, name }) => {
    await requireTeam(ctx, organizationId)
    return findEvent(ctx, organizationId, name.trim())
  },
})

export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    schema: eventSchemaValue,
  },
  returns: v.id("automationEvents"),
  handler: async (ctx, { organizationId, ...input }) => {
    await requireTeam(ctx, organizationId, "write")
    return defineEvent(ctx, organizationId, input)
  },
})

/** The dashboard keeps the name of an event an automation uses; the name
    can change otherwise. */
export const update = mutation({
  args: {
    id: v.id("automationEvents"),
    name: v.optional(v.string()),
    schema: v.optional(eventSchemaValue),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...input }) => {
    await changeEvent(ctx, await writableEvent(ctx, id), input)
    return null
  },
})

/** Past occurrences stay: they name the event, not the definition. */
export const remove = mutation({
  args: { id: v.id("automationEvents") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await writableEvent(ctx, id)
    await deleteAutomationEvent(ctx, id)
    return null
  },
})

/** Defines, without a schema, each name an automation mentions that no
    event has yet. Names that could not be an event are left alone. */
export const ensure = mutation({
  args: { organizationId: v.string(), names: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { organizationId, names }) => {
    await requireTeam(ctx, organizationId, "write")
    const unique = [...new Set(names.map((name) => name.trim()))]
    if (unique.length > ENSURE_LIMIT)
      throw new ConvexError(`Send at most ${ENSURE_LIMIT} event names`)
    for (const name of unique) {
      if (eventNameError(name) || name.length > MAX_NAME) continue
      if (!(await findEvent(ctx, organizationId, name)))
        await insertAutomationEvent(ctx, organizationId, { name, schema: [] })
    }
    return null
  },
})

/** Deletes occurrences past retention, a batch at a time. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("automationEventOccurrences")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - RETENTION)
      )
      .take(BATCH)
    for (const row of rows) await deleteOccurrence(ctx, row._id)
    if (rows.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.automationEvents.prune, {})
    return null
  },
})

export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    selectedId: v.optional(v.id("automationEvents")),
    selectedName: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (
    ctx,
    { organizationId, search, selectedId, selectedName }
  ) => {
    await requireTeam(ctx, organizationId, "read")
    const prefix = search?.trim() ?? ""
    const rows = await prefixOptions(
      ctx,
      "automationEvents",
      organizationId,
      prefix
    )
    let selected = await selectedOption(
      ctx,
      "automationEvents",
      organizationId,
      selectedId
    )
    if (!selected && selectedName)
      selected = await ctx.db
        .query("automationEvents")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", organizationId).eq("name", selectedName)
        )
        .unique()
    return includeSelected(rows, selected, (row) => row._id).map(
      (row) => row.name
    )
  },
})

/** All catalog definitions for this team, also used by save-time validation. */
export async function teamEventCatalog(ctx: QueryCtx, organizationId: string) {
  const custom = await ctx.db
    .query("automationEvents")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .collect()
  return eventCatalog(custom, await listProperties(ctx, organizationId))
}
export const catalog = query({
  args: { organizationId: v.string() },
  returns: v.string(),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    return JSON.stringify(await teamEventCatalog(ctx, organizationId))
  },
})
