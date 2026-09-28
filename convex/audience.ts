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
} from "../lib/dashboard/contacts"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/* The audience's write rules live here, keyed by team rather than by session,
   so the dashboard's mutations and the REST API share them. */

/** Per team. They also bound each contact's child rows (one membership per
    segment, one choice per topic) and every list the screens load whole. */
export const LIMITS = { segments: 500, topics: 100, properties: 100 }
/** Contacts or ids one mutation accepts; screens send larger sets in batches. */
export const BATCH = 100
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
  const row = (await ctx.db.get(table, id)) as Doc<T> | null
  if (!row || row.organizationId !== organizationId)
    throw new ConvexError(`${NOUN[table]} not found`)
  return row
}
const NOUN = { contacts: "Contact", segments: "Segment", topics: "Topic" }

export const listProperties = async (ctx: Ctx, organizationId: string) =>
  (
    await ctx.db
      .query("contactProperties")
      .withIndex("by_organizationId_and_key", (q) =>
        q.eq("organizationId", organizationId)
      )
      .take(LIMITS.properties * 2)
  ).filter((property) => !property.deleting)

export const contactSegmentIds = async (ctx: Ctx, contactId: Id<"contacts">) =>
  (
    await ctx.db
      .query("segmentMembers")
      .withIndex("by_contactId_and_segmentId", (q) =>
        q.eq("contactId", contactId)
      )
      .take(LIMITS.segments)
  ).map((row) => row.segmentId)

export const withSegments = async (ctx: Ctx, contact: Doc<"contacts">) => ({
  ...contact,
  segmentIds: await contactSegmentIds(ctx, contact._id),
})

const searchText = (contact: Pick<Doc<"contacts">, "email" | ContactName>) =>
  [
    contact.email,
    contact.email.replace(/[@._+-]+/g, " "),
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
    email: contact.email,
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
      segmentIds ?? (await contactSegmentIds(ctx, contact._id))
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

/** Joins every contact to every segment, emitting `contact.updated` for each
    contact whose segments changed. The ids must be the team's. */
export async function joinSegments(
  ctx: MutationCtx,
  contacts: Doc<"contacts">[],
  segmentIds: Id<"segments">[],
  emit = true
) {
  const changed: Doc<"contacts">[] = []
  for (const contact of contacts) {
    let any = false
    for (const segmentId of segmentIds)
      if (await setMembership(ctx, contact, segmentId, true)) any = true
    if (any) changed.push(contact)
  }
  if (emit)
    for (const contact of changed)
      await emitContact(ctx, "contact.updated", contact)
  return changed
}

export async function setTopicChoice(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  topicId: Id<"topics">,
  subscription: Doc<"topicSubscriptions">["subscription"]
) {
  const row = await ctx.db
    .query("topicSubscriptions")
    .withIndex("by_contactId_and_topicId", (q) =>
      q.eq("contactId", contact._id).eq("topicId", topicId)
    )
    .unique()
  if (row) {
    if (row.subscription !== subscription)
      await ctx.db.patch("topicSubscriptions", row._id, { subscription })
  } else
    await ctx.db.insert("topicSubscriptions", {
      organizationId: contact.organizationId,
      topicId,
      contactId: contact._id,
      subscription,
    })
}

/** Drops empty values: an empty property falls back to its default. */
const cleanProperties = (properties: Record<string, string>) =>
  Object.fromEntries(Object.entries(properties).filter(([, value]) => value))

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
  }
): Promise<{ id: Id<"contacts">; result: "created" | "updated" | "skipped" }> {
  const email = normalizeEmail(input.email)
  const error =
    contactEmailError(email) ?? contactFieldsError(input, options.properties)
  if (error) throw new ConvexError(error)
  const existing = await ctx.db
    .query("contacts")
    .withIndex("by_organizationId_and_email", (q) =>
      q.eq("organizationId", organizationId).eq("email", email)
    )
    .unique()
  const now = Date.now()
  if (existing) {
    if (options.skipExisting) return { id: existing._id, result: "skipped" }
    const fields = mergeContactFields(existing, {
      ...input,
      properties: cleanProperties(input.properties ?? {}),
    })
    const changed = fieldsChanged(existing, fields)
    const contact = changed
      ? await patchContact(ctx, existing, fields, now)
      : existing
    const joined = await joinSegments(ctx, [contact], options.segmentIds, false)
    if (changed || joined.length)
      await emitContact(ctx, "contact.updated", contact)
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
    email,
    ...fields,
    search: searchText({ email, ...fields }),
    updatedAt: now,
  })
  const contact = (await ctx.db.get("contacts", id))!
  await joinSegments(ctx, [contact], options.segmentIds, false)
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
  fields: ContactFields,
  now: number
) {
  const next = {
    ...fields,
    search: searchText({ email: contact.email, ...fields }),
    updatedAt: now,
  }
  return patchRow(ctx, "contacts", contact._id, next)
}

/** Changes the given fields. A property set to "" is cleared. */
export async function updateContact(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  patch: Partial<ContactFields>
) {
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
  if (!fieldsChanged(contact, fields)) return
  const next = await patchContact(ctx, contact, fields, Date.now())
  await emitContact(ctx, "contact.updated", next)
}

/** Deletes the contact at once. Its memberships and topic choices go in
    the same transaction when few, else in scheduled batches. */
export async function deleteContact(
  ctx: MutationCtx,
  contact: Doc<"contacts">
) {
  const segmentIds = await contactSegmentIds(ctx, contact._id)
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
  table: "segments" | "topics",
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
