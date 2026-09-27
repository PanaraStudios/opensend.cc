"use client"
import * as React from "react"
import {
  useMutation,
  usePaginatedQuery,
  useQuery,
  type OptionalRestArgsOrSkip,
} from "convex/react"
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import type { ContactInput } from "@/lib/dashboard/contacts"
import type {
  Contact,
  ContactProperty,
  Segment,
  Topic,
  TopicSubscription,
} from "@/lib/dashboard/types"

type ContactRow = FunctionReturnType<typeof api.contacts.list>["page"][number]
type ContactDetailRow = NonNullable<FunctionReturnType<typeof api.contacts.get>>

/** List rows carry segments only; the detail row adds explicit topic
    choices. Missing choices follow each topic's default. */
export function asContact(row: ContactRow | ContactDetailRow): Contact {
  return {
    id: row._id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    createdAt: row._creationTime,
    unsubscribed: row.unsubscribed,
    segmentIds: row.segmentIds,
    topics: "topics" in row ? row.topics : [],
    properties: row.properties,
  }
}
export const asSegment = (
  row: Doc<"segments">
): Segment & { count: number } => ({
  id: row._id,
  name: row.name,
  createdAt: row._creationTime,
  count: row.memberCount,
})
export const asTopic = (row: Doc<"topics">): Topic => ({
  id: row._id,
  name: row.name,
  description: row.description,
  defaultSubscription: row.defaultSubscription,
  visibility: row.visibility,
  createdAt: row._creationTime,
})
export const asProperty = (row: Doc<"contactProperties">): ContactProperty => ({
  id: row._id,
  key: row.key,
  name: row.name,
  type: row.type,
  fallbackValue: row.fallbackValue,
  createdAt: row._creationTime,
})

function useTeamQuery<
  Q extends FunctionReference<"query", "public", { organizationId: string }>,
>(fn: Q) {
  const { activeTeamId } = useWorkspace()
  return useQuery(
    fn,
    ...((activeTeamId
      ? [{ organizationId: activeTeamId }]
      : ["skip"]) as OptionalRestArgsOrSkip<Q>)
  )
}
type ContactFilters = Omit<
  FunctionArgs<typeof api.contacts.list>,
  "organizationId" | "paginationOpts"
>
/** The team's contacts, newest first, a page at a time. */
export function useContactList(filters: ContactFilters) {
  const { activeTeamId } = useWorkspace()
  const query = usePaginatedQuery(
    api.contacts.list,
    activeTeamId ? { organizationId: activeTeamId, ...filters } : "skip",
    { initialNumItems: 40 }
  )
  const rows = React.useMemo(
    () => query.results.map(asContact),
    [query.results]
  )
  return { ...query, rows }
}

/** A few of the team's contacts matching `search` (the newest when empty),
    for pickers such as the command menu. Skipped while `enabled` is false. */
export function useContactSearch(search: string, enabled = true) {
  const { activeTeamId } = useWorkspace()
  const page = useQuery(
    api.contacts.list,
    enabled && activeTeamId
      ? {
          organizationId: activeTeamId,
          search,
          paginationOpts: { numItems: 8, cursor: null },
        }
      : "skip"
  )
  return React.useMemo(() => page?.page.map(asContact) ?? [], [page])
}

/* Each whole list (capped per team), or undefined while loading. */
export function useSegments() {
  const rows = useTeamQuery(api.segments.list)
  return React.useMemo(() => rows?.map(asSegment), [rows])
}
export function useTopics() {
  const rows = useTeamQuery(api.topics.list)
  return React.useMemo(() => rows?.map(asTopic), [rows])
}
export function useProperties() {
  const rows = useTeamQuery(api.contactProperties.list)
  return React.useMemo(() => rows?.map(asProperty), [rows])
}

/** Rows one mutation takes; bigger selections and imports go in batches. */
export const AUDIENCE_BATCH = 100
function chunks<T>(items: T[]) {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += AUDIENCE_BATCH)
    out.push(items.slice(i, i + AUDIENCE_BATCH))
  return out
}

export function useAudienceCommands() {
  const { activeTeamId } = useWorkspace()
  const upsert = useMutation(api.contacts.upsert)
  const update = useMutation(api.contacts.update)
  const remove = useMutation(api.contacts.remove)
  const setSegment = useMutation(api.contacts.setSegment)
  const addToSegments = useMutation(api.contacts.addToSegments)
  const setTopic = useMutation(api.contacts.setTopic)
  const subscribe = useMutation(api.contacts.subscribeToTopics)
  const createSegment = useMutation(api.segments.create)
  const updateSegment = useMutation(api.segments.update)
  const removeSegment = useMutation(api.segments.remove)
  const createTopic = useMutation(api.topics.create)
  const updateTopic = useMutation(api.topics.update)
  const removeTopic = useMutation(api.topics.remove)
  const createProperty = useMutation(api.contactProperties.create)
  const removeProperty = useMutation(api.contactProperties.remove)
  const team = () => {
    if (!activeTeamId) throw new Error("Create a team first")
    return activeTeamId
  }
  const contactIds = (ids: string[]) => ids as Id<"contacts">[]
  return {
    /** Creates or merges by email, in batches. With `skipExisting`, known
        addresses are left alone and counted as skipped. */
    async upsertContacts(
      inputs: ContactInput[],
      segmentIds: string[],
      skipExisting = false
    ) {
      const total = {
        created: 0,
        updated: 0,
        skipped: 0,
        createdIds: [] as string[],
        errors: [] as string[],
      }
      for (const batch of chunks(inputs)) {
        const result = await upsert({
          organizationId: team(),
          contacts: batch,
          segmentIds: segmentIds as Id<"segments">[],
          skipExisting,
        })
        total.created += result.created
        total.updated += result.updated
        total.skipped += result.skipped
        total.createdIds.push(...result.createdIds)
        total.errors.push(...result.errors)
      }
      return total
    },
    updateContact: (
      id: string,
      patch: Partial<
        Pick<Contact, "firstName" | "lastName" | "unsubscribed" | "properties">
      >
    ) => update({ id: id as Id<"contacts">, ...patch }),
    async deleteContacts(ids: string[]) {
      for (const batch of chunks(contactIds(ids)))
        await remove({ organizationId: team(), ids: batch })
    },
    setContactSegment: (id: string, segmentId: string, member: boolean) =>
      setSegment({
        id: id as Id<"contacts">,
        segmentId: segmentId as Id<"segments">,
        member,
      }),
    async addContactsToSegments(ids: string[], segmentIds: string[]) {
      for (const batch of chunks(contactIds(ids)))
        await addToSegments({
          organizationId: team(),
          ids: batch,
          segmentIds: segmentIds as Id<"segments">[],
        })
    },
    setContactTopic: (
      id: string,
      topicId: string,
      subscription: TopicSubscription
    ) =>
      setTopic({
        id: id as Id<"contacts">,
        topicId: topicId as Id<"topics">,
        subscription,
      }),
    async subscribeContactsToTopics(ids: string[], topicIds: string[]) {
      for (const batch of chunks(contactIds(ids)))
        await subscribe({
          organizationId: team(),
          ids: batch,
          topicIds: topicIds as Id<"topics">[],
        })
    },
    addSegment: (name: string) =>
      createSegment({ organizationId: team(), name }),
    updateSegment: (id: string, name: string) =>
      updateSegment({ id: id as Id<"segments">, name }),
    deleteSegment: (id: string) => removeSegment({ id: id as Id<"segments"> }),
    addTopic: (
      input: Pick<
        Topic,
        "name" | "description" | "defaultSubscription" | "visibility"
      >
    ) => createTopic({ organizationId: team(), ...input }),
    updateTopic: (
      id: string,
      patch: Partial<Pick<Topic, "name" | "description" | "visibility">>
    ) => updateTopic({ id: id as Id<"topics">, ...patch }),
    deleteTopic: (id: string) => removeTopic({ id: id as Id<"topics"> }),
    addProperty: (
      input: Pick<ContactProperty, "key" | "name" | "type" | "fallbackValue">
    ) => createProperty({ organizationId: team(), ...input }),
    deleteProperty: (id: string) =>
      removeProperty({ id: id as Id<"contactProperties"> }),
  }
}
