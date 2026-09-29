"use client"
import * as React from "react"
import {
  useMutation,
  useConvex,
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
import {
  useLoadedPagination,
  useTeamList,
} from "@/components/dashboard/primitives"
import { PAGE_SIZES } from "@/lib/dashboard/pagination"
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
    topics: "topics" in row ? row.topics : [],
    properties: row.properties,
  }
}
export const asSegment = (
  row: FunctionReturnType<typeof api.segments.options>[number]
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
/** The team's contacts, newest first, a page at a time. */
export const useContactList = (
  filters: Omit<
    FunctionArgs<typeof api.contacts.list>,
    "organizationId" | "paginationOpts"
  >
) => useTeamList(api.contacts.list, api.contacts.count, filters, asContact)
export const useSegmentList = (search: string) =>
  useTeamList(api.segments.list, api.segments.count, { search }, asSegment)
export const useTopicList = (search: string) =>
  useTeamList(api.topics.list, api.topics.count, { search }, asTopic)
/** Bounded server suggestions for the command menu. */
export function useContactSearch(search: string, enabled = true) {
  const { activeTeamId } = useWorkspace()
  const rows = useQuery(
    api.contacts.options,
    enabled && activeTeamId ? { organizationId: activeTeamId, search } : "skip"
  )
  return React.useMemo(
    () =>
      rows?.map((row) => ({
        id: row._id,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
      })) ?? [],
    [rows]
  )
}

export function useSegmentOptions(selectedId?: string | null, search?: string) {
  const { activeTeamId } = useWorkspace()
  const rows = useQuery(
    api.segments.options,
    activeTeamId
      ? {
          organizationId: activeTeamId,
          search,
          selectedId: selectedId ? (selectedId as Id<"segments">) : undefined,
        }
      : "skip"
  )
  return React.useMemo(() => rows?.map(asSegment), [rows])
}
export function useTopicOptions(selectedId?: string | null, search?: string) {
  const { activeTeamId } = useWorkspace()
  const rows = useQuery(
    api.topics.options,
    activeTeamId
      ? {
          organizationId: activeTeamId,
          search,
          selectedId: selectedId ? (selectedId as Id<"topics">) : undefined,
        }
      : "skip"
  )
  return React.useMemo(() => rows?.map(asTopic), [rows])
}

/** Whether the team has any segment yet, or undefined while loading. */
export function useHasSegments() {
  const counted = useTeamQuery(api.segments.count)
  return counted === undefined ? undefined : (counted.total ?? 0) > 0
}
/** A contact's segments, most recently joined first, a page at a time. */
export function useContactSegments(contactId: string) {
  const query = usePaginatedQuery(
    api.contacts.segments,
    { id: contactId as Id<"contacts"> },
    { initialNumItems: PAGE_SIZES[0] }
  )
  return { ...query, ...useLoadedPagination(query.results, query) }
}

/* Each whole list (capped per team), for pickers, or undefined while
   loading. The list screens page theirs; segments are never loaded whole. */
export function useTopics() {
  const rows = useTeamQuery(api.topics.definitions)
  return React.useMemo(() => rows?.map(asTopic), [rows])
}
export function useProperties() {
  const rows = useTeamQuery(api.contactProperties.definitions)
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
  const convex = useConvex()
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
      skipExisting = false,
      csvImport = false
    ) {
      const total = {
        created: 0,
        updated: 0,
        skipped: 0,
        createdIds: [] as string[],
        errors: [] as string[],
      }
      const pending: Id<"contactImports">[] = []
      // The server joins memberships past one transaction's share in steps.
      for (const batch of chunks(inputs)) {
        const result = await upsert({
          organizationId: team(),
          contacts: batch,
          segmentIds: segmentIds as Id<"segments">[],
          skipExisting,
          csvImport,
        })
        if (result.jobId) pending.push(result.jobId)
        total.created += result.created
        total.updated += result.updated
        total.skipped += result.skipped
        total.createdIds.push(...result.createdIds)
        total.errors.push(...result.errors)
      }
      for (const id of pending) {
        const result = await new Promise<
          FunctionReturnType<typeof api.contactImports.get>
        >((resolve, reject) => {
          const watch = convex.watchQuery(api.contactImports.get, { id })
          const stop = watch.onUpdate(() => {
            try {
              const job = watch.localQueryResult()
              if (job === undefined || job?.status === "processing") return
              stop()
              if (!job || job.status === "failed")
                reject(new Error(job?.error ?? "Import could not be completed"))
              else resolve(job)
            } catch (error) {
              stop()
              reject(error)
            }
          })
        })
        if (result) {
          total.created += result.result.created
          total.updated += result.result.updated
          total.skipped += result.result.skipped
          total.createdIds.push(...result.result.createdIds)
          total.errors.push(...result.result.errors)
        }
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
