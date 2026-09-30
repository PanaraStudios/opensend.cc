import { normalizePhone } from "../lib/dashboard/phone"
import { teamRow as findTeamRow } from "./lists"
import { ConvexError } from "convex/values"
import { internal } from "./_generated/api"
import { emitEvent } from "./events"
import { deleteRow, insertRow, patchRow } from "./counts"
import {
  contactEmailError,
  contactFieldsError,
  mergeContactFields,
  normalizeEmail,
  type ContactFields,
  type ContactInput,
  type ContactIdentity,
} from "../lib/dashboard/contacts"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/* The audience's write rules live here, keyed by team rather than by session,
   so the dashboard's mutations and the REST API share them. */

/** Per team. They also bound each contact's topic choices and the topic and
    property lists the screens load whole. Segments have no limit: nothing
    reads all of a team's segments, or all of a contact's, in one transaction. */
export const LIMITS = { topics: 100, properties: 100 }
/** Contacts or ids one mutation accepts; screens send larger sets in batches. */
export const BATCH = 100
/** Segment ids one request names. Each is checked with its own read, and a
    transaction reads at most 4,096 ranges
    (https://docs.convex.dev/production/state/limits#transactions). */
export const SEGMENT_INPUT_LIMIT = 1000
/** Memberships one transaction writes; the rest follow in scheduled steps. */
export const MEMBERSHIP_BATCH = 200
/** Segment ids a contact webhook carries, most recently joined first. The
    event is one stored document, and bulk writes emit one per contact. */
export const EVENT_SEGMENT_IDS = 100
/** Child rows a cleanup pass deletes before handing on to the next. */
export const CLEANUP_BATCH = 500

type Ctx = QueryCtx | MutationCtx

/** A team's row, or "not found" for a missing row or another team's. */
export async function teamRow<T extends "contacts" | "segments" | "topics">(
  ctx: Ctx,
  table: T,
  organizationId: string,
  id: Id<T>
) {
  const row = await findTeamRow(ctx, table, organizationId, id)
  if (!row) throw new ConvexError(`${NOUN[table]} not found`)
  return row
}
const NOUN = { contacts: "Contact", segments: "Segment", topics: "Topic" }

export const listProperties = async (ctx: Ctx, organizationId: string) => {
  // Legacy active rows have no flag; newer callers may explicitly store false.
  const groups = await Promise.all(
    [undefined, false].map((deleting) =>
      ctx.db
        .query("contactProperties")
        .withIndex("by_organizationId_and_deleting", (q) =>
          q.eq("organizationId", organizationId).eq("deleting", deleting)
        )
        .take(LIMITS.properties + 1)
    )
  )
  const properties = groups.flat()
  if (properties.length > LIMITS.properties)
    throw new ConvexError(
      "Too many active contact properties. Remove unused properties before continuing."
    )
  return properties
}

/** A contact's memberships, most recently joined first. */
export const contactMemberships = (ctx: Ctx, contactId: Id<"contacts">) =>
  ctx.db
    .query("segmentMembers")
    .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
    .order("desc")

/** The segment ids a contact webhook carries; see `EVENT_SEGMENT_IDS`. */
export const eventSegmentIds = async (ctx: Ctx, contactId: Id<"contacts">) =>
  (await contactMemberships(ctx, contactId).take(EVENT_SEGMENT_IDS)).map(
    (row) => row.segmentId
  )

/** Deduplicates the segment ids a request names; see `SEGMENT_INPUT_LIMIT`. */
export function segmentInput(ids: Id<"segments">[]) {
  const unique = [...new Set(ids)]
  if (unique.length > SEGMENT_INPUT_LIMIT)
    throw new ConvexError(
      `Choose at most ${SEGMENT_INPUT_LIMIT} segments at a time`
    )
  return unique
}

const searchText = (
  contact: Pick<Doc<"contacts">, "email" | "phone" | ContactName>
) =>
  [
    contact.email,
    contact.email?.replace(/[@._+-]+/g, " "),
    contact.phone,
    contact.phone?.slice(1),
    contact.firstName,
    contact.lastName,
  ].join(" ")
type ContactName = "firstName" | "lastName"

/** Resend's contact webhook data. */
export function contactEventData(
  contact: Doc<"contacts">,
  segmentIds: Id<"segments">[]
) {
  return {
    id: contact._id,
    segment_ids: segmentIds,
    created_at: new Date(contact._creationTime).toISOString(),
    updated_at: new Date(contact.updatedAt).toISOString(),
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    first_name: contact.firstName || null,
    last_name: contact.lastName || null,
    unsubscribed: contact.unsubscribed,
  }
}
export async function emitContact(
  ctx: MutationCtx,
  type: "contact.created" | "contact.updated" | "contact.deleted",
  contact: Doc<"contacts">,
  segmentIds?: Id<"segments">[]
) {
  await emitEvent(
    ctx,
    contact.organizationId,
    type,
    contactEventData(
      contact,
      segmentIds?.slice(0, EVENT_SEGMENT_IDS) ??
        (await eventSegmentIds(ctx, contact._id))
    )
  )
}

/** Puts the contact in or out of the segment. Returns whether it changed. */
export async function setMembership(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  segmentId: Id<"segments">,
  member: boolean
) {
  const row = await ctx.db
    .query("segmentMembers")
    .withIndex("by_contactId_and_segmentId", (q) =>
      q.eq("contactId", contact._id).eq("segmentId", segmentId)
    )
    .unique()
  if (!!row === member) return false
  if (row) await deleteRow(ctx, "segmentMembers", row._id)
  else
    await insertRow(ctx, "segmentMembers", {
      organizationId: contact.organizationId,
      segmentId,
      contactId: contact._id,
    })
  return true
}

/** How many memberships the current transaction may still write. */
export type MembershipBudget = { left: number }
export const membershipBudget = (): MembershipBudget => ({
  left: MEMBERSHIP_BATCH,
})

/** Joins the contact to the segments while `budget` lasts, then hands the
    rest to a scheduled step, so any number of segments stays within one
    transaction's limits. Once the last segment is joined, emits one
    `contact.updated` if `changed` (the caller changed the contact) or a
    membership changed. With `recheck`, segments deleted since the ids were
    checked are skipped; otherwise they must be the team's. */
export async function joinContact(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  segmentIds: Id<"segments">[],
  budget: MembershipBudget,
  options: { emit: boolean; changed?: boolean; recheck?: boolean }
) {
  let changed = options.changed ?? false
  let index = 0
  for (; index < segmentIds.length && budget.left > 0; index++) {
    budget.left--
    const segmentId = segmentIds[index]
    if (options.recheck) {
      const segment = await ctx.db.get("segments", segmentId)
      if (segment?.organizationId !== contact.organizationId) continue
    }
    if (await setMembership(ctx, contact, segmentId, true)) changed = true
  }
  if (index < segmentIds.length)
    await ctx.scheduler.runAfter(0, internal.contacts.joinRest, {
      contactId: contact._id,
      segmentIds: segmentIds.slice(index),
      changed,
      emit: options.emit,
    })
  else if (changed && options.emit)
    await emitContact(ctx, "contact.updated", contact)
}

/** Joins every contact to every segment, emitting `contact.updated` for each
    contact whose segments changed. The ids must be the team's. */
export async function joinSegments(
  ctx: MutationCtx,
  contacts: Doc<"contacts">[],
  segmentIds: Id<"segments">[]
) {
  const budget = membershipBudget()
  for (const contact of contacts)
    await joinContact(ctx, contact, segmentIds, budget, { emit: true })
}

export const findTopicChoice = (
  ctx: Ctx,
  contactId: Id<"contacts">,
  topicId: Id<"topics">
) =>
  ctx.db
    .query("topicSubscriptions")
    .withIndex("by_contactId_and_topicId", (q) =>
      q.eq("contactId", contactId).eq("topicId", topicId)
    )
    .unique()

/** Records the contact's explicit choice. Returns whether it changed. */
async function setTopicChoice(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  topicId: Id<"topics">,
  subscription: Doc<"topicSubscriptions">["subscription"]
) {
  const row = await findTopicChoice(ctx, contact._id, topicId)
  if (row?.subscription === subscription) return false
  if (row) await ctx.db.patch("topicSubscriptions", row._id, { subscription })
  else
    await ctx.db.insert("topicSubscriptions", {
      organizationId: contact.organizationId,
      topicId,
      contactId: contact._id,
      subscription,
    })
  return true
}

/** One event per contact operation, including multi-topic updates. */
export async function setTopicChoices(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  choices: {
    topicId: Id<"topics">
    subscription: Doc<"topicSubscriptions">["subscription"]
  }[],
  options: { emit?: boolean } = {}
) {
  let changed = false
  for (const choice of choices) {
    await teamRow(ctx, "topics", contact.organizationId, choice.topicId)
    if (await setTopicChoice(ctx, contact, choice.topicId, choice.subscription))
      changed = true
  }
  if (changed) {
    const next = await patchRow(ctx, "contacts", contact._id, {
      updatedAt: Date.now(),
    })
    if (options.emit !== false) await emitContact(ctx, "contact.updated", next)
  }
  return changed
}

/** Drops empty values: an empty property falls back to its default. */
const cleanProperties = (properties: Record<string, string>) =>
  Object.fromEntries(Object.entries(properties).filter(([, value]) => value))

/** Shared create/update identity rules. Empty strings clear an identity. */
function normalizeIdentity(input: ContactIdentity): ContactIdentity {
  const email = input.email?.trim() ? normalizeEmail(input.email) : undefined
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : undefined
  if (email) {
    const error = contactEmailError(email)
    if (error) throw new ConvexError(error)
  }
  if (phone === null)
    throw new ConvexError(
      "Enter a phone number with + and 8–15 digits, including the country code"
    )
  if (!email && !phone)
    throw new ConvexError("An email or phone number is required")
  return { email, phone }
}
const identityChanged = (contact: ContactIdentity, input: ContactIdentity) =>
  contact.email !== input.email || contact.phone !== input.phone
const findIdentity = (
  ctx: Ctx,
  organizationId: string,
  key: "email" | "phone",
  value: string
) =>
  ctx.db
    .query("contacts")
    .withIndex(
      key === "email"
        ? "by_organizationId_and_email"
        : "by_organizationId_and_phone",
      (q) => q.eq("organizationId", organizationId).eq(key, value)
    )
    .unique()

/** Creates a contact, or merges into the team's contact with that address.
    Validates before writing, so a throw leaves nothing behind. With
    `skipExisting`, an existing address is left untouched. */
export async function upsertContact(
  ctx: MutationCtx,
  organizationId: string,
  input: ContactInput,
  options: {
    properties: Pick<Doc<"contactProperties">, "key" | "type">[]
    segmentIds: Id<"segments">[]
    skipExisting?: boolean
    emit?: boolean
    /** Imports may merge a phone-only row into an existing contact. */
    mergePhone?: boolean
    /** Shared by a batch of contacts; memberships past it are scheduled. */
    budget?: MembershipBudget
  }
): Promise<{ id: Id<"contacts">; result: "created" | "updated" | "skipped" }> {
  const budget = options.budget ?? membershipBudget()
  const identity = normalizeIdentity(input)
  const error = contactFieldsError(input, options.properties)
  if (error) throw new ConvexError(error)
  const byEmail = identity.email
    ? await findIdentity(ctx, organizationId, "email", identity.email)
    : null
  const byPhone = identity.phone
    ? await findIdentity(ctx, organizationId, "phone", identity.phone)
    : null
  if (byPhone && byEmail?._id !== byPhone._id && (byEmail || identity.email))
    throw new ConvexError("That phone number already exists")
  const existing = byEmail ?? byPhone
  if (byPhone && !byEmail && !options.mergePhone && !options.skipExisting)
    throw new ConvexError("That phone number already exists")
  const now = Date.now()
  if (existing) {
    if (options.skipExisting) return { id: existing._id, result: "skipped" }
    const fields = mergeContactFields(existing, {
      ...input,
      properties: cleanProperties(input.properties ?? {}),
    })
    const nextIdentity = {
      email: identity.email ?? existing.email,
      phone: identity.phone ?? existing.phone,
    }
    const changed =
      fieldsChanged(existing, fields) || identityChanged(existing, nextIdentity)
    const contact = changed
      ? await patchContact(ctx, existing, { ...fields, ...nextIdentity }, now)
      : existing
    await joinContact(ctx, contact, options.segmentIds, budget, {
      emit: options.emit !== false,
      changed,
    })
    return { id: existing._id, result: "updated" }
  }
  const fields = {
    firstName: input.firstName?.trim() ?? "",
    lastName: input.lastName?.trim() ?? "",
    unsubscribed: input.unsubscribed ?? false,
    properties: cleanProperties(input.properties ?? {}),
  }
  const id = await insertRow(ctx, "contacts", {
    organizationId,
    ...identity,
    ...fields,
    search: searchText({ ...identity, ...fields }),
    updatedAt: now,
  })
  const contact = (await ctx.db.get("contacts", id))!
  await joinContact(ctx, contact, options.segmentIds, budget, { emit: false })
  if (options.emit !== false)
    await emitContact(ctx, "contact.created", contact, options.segmentIds)
  return { id, result: "created" }
}

function fieldsChanged(contact: Doc<"contacts">, fields: ContactFields) {
  const keys = new Set([
    ...Object.keys(contact.properties),
    ...Object.keys(fields.properties),
  ])
  return (
    contact.firstName !== fields.firstName ||
    contact.lastName !== fields.lastName ||
    contact.unsubscribed !== fields.unsubscribed ||
    [...keys].some((key) => contact.properties[key] !== fields.properties[key])
  )
}
async function patchContact(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  fields: ContactFields & ContactIdentity,
  now: number
) {
  const next = {
    ...fields,
    search: searchText({ ...contact, ...fields }),
    updatedAt: now,
  }
  return patchRow(ctx, "contacts", contact._id, next)
}

/** Changes the given fields. A property set to "" is cleared. */
export async function updateContact(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  patch: Partial<ContactFields> & ContactIdentity
) {
  const identity = normalizeIdentity({
    email: patch.email === undefined ? contact.email : patch.email,
    phone: patch.phone === undefined ? contact.phone : patch.phone,
  })
  for (const key of ["email", "phone"] as const) {
    const value = identity[key]
    const other =
      value && (await findIdentity(ctx, contact.organizationId, key, value))
    if (other && other._id !== contact._id)
      throw new ConvexError(
        `That ${key === "phone" ? "phone number" : "email address"} already exists`
      )
  }
  const error = contactFieldsError(
    patch,
    await listProperties(ctx, contact.organizationId)
  )
  if (error) throw new ConvexError(error)
  const fields: ContactFields = {
    firstName: patch.firstName?.trim() ?? contact.firstName,
    lastName: patch.lastName?.trim() ?? contact.lastName,
    unsubscribed: patch.unsubscribed ?? contact.unsubscribed,
    properties: cleanProperties({
      ...contact.properties,
      ...(patch.properties ?? {}),
    }),
  }
  if (!fieldsChanged(contact, fields) && !identityChanged(contact, identity))
    return
  const next = await patchContact(
    ctx,
    contact,
    { ...fields, ...identity },
    Date.now()
  )
  await emitContact(ctx, "contact.updated", next)
}

/** Deletes the contact at once. Its memberships and topic choices go in
    the same transaction when few, else in scheduled batches. */
export async function deleteContact(
  ctx: MutationCtx,
  contact: Doc<"contacts">
) {
  const segmentIds = await eventSegmentIds(ctx, contact._id)
  await deleteRow(ctx, "contacts", contact._id)
  await emitContact(
    ctx,
    "contact.deleted",
    { ...contact, updatedAt: Date.now() },
    segmentIds
  )
  if (!(await purgeContactRows(ctx, contact._id, 50)))
    await ctx.scheduler.runAfter(0, internal.contacts.purge, {
      contactId: contact._id,
    })
}

/** Deletes up to `limit` of a deleted contact's child rows. Returns whether
    none are left. */
export async function purgeContactRows(
  ctx: MutationCtx,
  contactId: Id<"contacts">,
  limit: number
) {
  const members = await ctx.db
    .query("segmentMembers")
    .withIndex("by_contactId_and_segmentId", (q) =>
      q.eq("contactId", contactId)
    )
    .take(limit)
  for (const row of members) await deleteRow(ctx, "segmentMembers", row._id)
  const choices = await ctx.db
    .query("topicSubscriptions")
    .withIndex("by_contactId_and_topicId", (q) => q.eq("contactId", contactId))
    .take(limit - members.length)
  for (const row of choices) await ctx.db.delete("topicSubscriptions", row._id)
  return members.length + choices.length < limit
}

/** Refuses a list that is already at its per-team limit. */
export async function requireRoom(
  ctx: MutationCtx,
  table: "topics",
  organizationId: string
) {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .take(LIMITS[table])
  if (rows.length >= LIMITS[table])
    throw new ConvexError(`A team can have up to ${LIMITS[table]} ${table}`)
}
