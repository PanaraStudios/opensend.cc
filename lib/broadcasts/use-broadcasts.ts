"use client"
import * as React from "react"
import { useConvex, useMutation, usePaginatedQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { FunctionReturnType } from "convex/server"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import {
  useWorkspace,
  requireTeamId,
  useTeamQuery,
} from "@/components/auth/workspace"
import {
  useTeamList,
  useLoadedPagination,
} from "@/components/dashboard/primitives"
import type { Broadcast, EmailDraft } from "@/lib/dashboard/types"
import { emptyBroadcastStats } from "@/lib/dashboard/broadcast"
export type BroadcastPatch = Partial<
  Omit<EmailDraft, "id"> &
    Pick<Broadcast, "segmentId" | "topicId" | "channel" | "whatsapp">
>
export function asBroadcast(
  row: Doc<"broadcasts">,
  body?: { html: string; content?: unknown } | null
): Broadcast {
  return {
    id: row._id,
    name: row.name,
    channel: row.channel,
    whatsapp: row.whatsapp,
    subject: row.subject,
    preview: row.preview,
    html: body?.html ?? "",
    content: body?.content as Broadcast["content"],
    from: row.from,
    replyTo: row.replyTo,
    segmentId: row.segmentId,
    topicId: row.topicId,
    status: row.status,
    createdAt: row._creationTime,
    updatedAt: row.updatedAt,
    scheduledAt: row.scheduledAt ?? null,
    sentAt: row.sentAt ?? null,
    stats: emptyBroadcastStats(),
  }
}
function wire(patch: BroadcastPatch) {
  const { content, from, replyTo, segmentId, topicId, whatsapp, ...rest } =
    patch
  return {
    ...rest,
    ...(whatsapp
      ? {
          whatsapp: {
            ...whatsapp,
            accountId: whatsapp.accountId as Id<"channelAccounts">,
            templateId: whatsapp.templateId as Id<"templates">,
          },
        }
      : {}),
    ...("content" in patch ? { content: content ?? null } : {}),
    ...("from" in patch ? { from: from ?? "" } : {}),
    ...("replyTo" in patch ? { replyTo: replyTo ?? "" } : {}),
    ...(segmentId === undefined
      ? {}
      : { segmentId: segmentId as Id<"segments"> | null }),
    ...(topicId === undefined
      ? {}
      : { topicId: topicId as Id<"topics"> | null }),
  }
}
export function useBroadcast(id: string) {
  const result = useTeamQuery(api.broadcasts.get, { id })
  const metrics = useTeamQuery(
    api.broadcastMetrics.channelStats,
    { id: result ? result.row._id : (id as Id<"broadcasts">) },
    { enabled: !!result }
  )
  return React.useMemo(
    () =>
      result === undefined
        ? undefined
        : result === null
          ? null
          : {
              ...asBroadcast(result.row, result.body),
              stats:
                metrics?.channel === "email"
                  ? metrics.stats
                  : emptyBroadcastStats(),
              whatsappStats:
                metrics?.channel === "whatsapp" ? metrics.stats : undefined,
            },
    [result, metrics]
  )
}
export function useBroadcastCommands() {
  const { activeTeamId } = useWorkspace()
  const convex = useConvex()
  const create = useMutation(api.broadcasts.create)
  const update = useMutation(api.broadcasts.update)
  const duplicate = useMutation(api.broadcasts.duplicate)
  const remove = useMutation(api.broadcasts.remove)
  const send = useMutation(api.broadcasts.send)
  const cancel = useMutation(api.broadcasts.cancel)
  const ref = (id: string) => ({ id: id as Id<"broadcasts"> })
  return {
    addBroadcast: async (input: BroadcastPatch) => {
      const organizationId = requireTeamId(activeTeamId)
      return {
        id: await create({ organizationId, ...wire(input) }),
      }
    },
    updateBroadcast: (id: string, patch: BroadcastPatch) =>
      update({ ...ref(id), ...wire(patch) }),
    duplicateBroadcast: async (id: string) => ({
      id: await duplicate(ref(id)),
    }),
    deleteBroadcast: (id: string) => remove(ref(id)),
    sendBroadcast: (id: string, scheduledAt?: number) =>
      send({ ...ref(id), scheduledAt }),
    cancelBroadcast: (id: string) => cancel(ref(id)),
    readBroadcast: async (id: string) => {
      const organizationId = requireTeamId(activeTeamId)
      const result = await convex.query(api.broadcasts.get, {
        organizationId,
        id,
      })
      if (!result) throw new Error("Broadcast not found")
      return asBroadcast(result.row, result.body)
    },
  }
}
export function useBroadcastSaver(item: Broadcast) {
  const update = useMutation(api.broadcasts.update)
  const [sent] = React.useState(
    () =>
      new Map(
        [
          "name",
          "subject",
          "preview",
          "html",
          "content",
          "from",
          "replyTo",
        ].map((key) => [
          key,
          JSON.stringify(item[key as keyof Broadcast] ?? null),
        ])
      )
  )
  return React.useCallback(
    async (patch: BroadcastPatch) => {
      const entries = Object.entries(patch).filter(
        ([key, value]) => sent.get(key) !== JSON.stringify(value ?? null)
      )
      if (!entries.length) return
      for (const [key, value] of entries)
        sent.set(key, JSON.stringify(value ?? null))
      try {
        await update({
          id: item.id as Id<"broadcasts">,
          ...wire(Object.fromEntries(entries)),
        })
      } catch (error) {
        for (const [key] of entries) sent.delete(key)
        throw error
      }
    },
    [item.id, sent, update]
  )
}
export function useContactBroadcasts(contactId: string) {
  return useTeamList(
    api.broadcasts.history,
    api.broadcasts.historyCount,
    { contactId: contactId as Id<"contacts"> },
    asBroadcastHistory
  )
}

/** Recipient paging uses the same loaded-page controls as email reports. */
export function useWhatsAppBroadcastRecipients(id: string) {
  const { activeTeamId } = useWorkspace()
  const { results, ...page } = usePaginatedQuery(
    api.broadcastWhatsApp.recipients,
    activeTeamId
      ? { organizationId: activeTeamId, id: id as Id<"broadcasts"> }
      : "skip",
    { initialNumItems: 20 }
  )
  return useLoadedPagination(results, page)
}

function asBroadcastHistory(
  row: FunctionReturnType<typeof api.broadcasts.history>["page"][number]
) {
  return {
    ...asBroadcast(row),
    recipient: row.recipient,
    messageStatus: row.messageStatus,
  }
}
