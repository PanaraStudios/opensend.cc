"use client"
import * as React from "react"
import { useMutation, useQuery } from "convex/react"
import { usePagedList, useTeamList } from "@/components/dashboard/primitives"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import type {
  EmailStatus,
  SentEmail,
  Suppression,
  SuppressionReason,
} from "@/lib/dashboard/types"

/** A sent email in the dashboard's shape. `to` joins every recipient; the
    body comes with the detail query; timelines page independently. */
export function asEmail(
  row: Doc<"emails">,
  detail?: { html: string; text: string; events?: Doc<"emailEvents">[] }
): SentEmail {
  return {
    id: row._id,
    from: row.from,
    to: row.to.join(", "),
    subject: row.subject,
    status: row.status,
    createdAt: row._creationTime,
    scheduledAt: row.scheduledAt ?? null,
    html: detail?.html ?? "",
    text: detail?.text ?? "",
    events: (detail?.events ?? []).map((event) => ({
      id: event._id,
      type: event.type,
      at: event.at,
    })),
    broadcastId: row.broadcastId ?? null,
  }
}

export function asSuppression(row: Doc<"suppressions">): Suppression {
  return {
    id: row._id,
    email: row.email,
    reason: row.reason,
    createdAt: row._creationTime,
  }
}

const asEmailRow = (row: Doc<"emails">) => asEmail(row)

type Range = { from?: number; to?: number }

export function useEmailList(
  filters: Range & { status?: EmailStatus; search?: string }
) {
  return useTeamList(api.emails.list, api.emails.count, filters, asEmailRow)
}

/** How many emails the command menu lists. */
const EMAIL_SEARCH_LIMIT = 20

/** The team's emails matching `search` (the newest when empty), for the
    command menu. Skipped while `enabled` is false. */
export function useEmailSearch(search: string, enabled = true) {
  const { activeTeamId } = useWorkspace()
  const page = useQuery(
    api.emails.list,
    enabled && activeTeamId
      ? {
          organizationId: activeTeamId,
          search,
          paginationOpts: { numItems: EMAIL_SEARCH_LIMIT, cursor: null },
        }
      : "skip"
  )
  return React.useMemo(
    () => page?.page.map((row) => asEmail(row)) ?? [],
    [page]
  )
}

/** Every email sent to one address, newest first. */
export function useRecipientEmails(address: string) {
  return useTeamList(
    api.emails.byRecipient,
    api.emails.byRecipientCount,
    { address },
    asEmailRow
  )
}

/** One email with its body and the request that sent it;
    undefined while loading, null when there is no such email. */
export function useEmail(id: string | null | undefined) {
  const found = useQuery(api.emails.get, id ? { id } : "skip")
  return React.useMemo(() => {
    if (!found) return found
    return {
      email: asEmail(found.email, found),
      log: found.log
        ? { id: found.log._id, createdAt: found.log._creationTime }
        : null,
    }
  }, [found])
}

export function useSuppressionList(
  filters: Range & { reason?: SuppressionReason; search?: string }
) {
  return useTeamList(
    api.suppressions.list,
    api.suppressions.count,
    filters,
    asSuppression
  )
}

export function useEmailCommands() {
  const { activeTeamId } = useWorkspace()
  const cancel = useMutation(api.emails.cancel)
  const add = useMutation(api.suppressions.add)
  const remove = useMutation(api.suppressions.remove)
  return {
    cancelEmail: (id: string) => cancel({ id: id as Id<"emails"> }),
    addSuppression: (input: { email: string; reason: SuppressionReason }) => {
      if (!activeTeamId) throw new Error("Create a team first")
      return add({ ...input, organizationId: activeTeamId })
    },
    removeSuppression: (id: string) => remove({ id: id as Id<"suppressions"> }),
  }
}

const asEmailEvent = (row: Doc<"emailEvents">) => ({
  id: row._id,
  type: row.type,
  at: row.at,
})

export function useEmailEvents(id: string | undefined, insights = false) {
  return usePagedList(
    api.emails.timeline,
    api.emails.timelineCount,
    id ? { id: id as Id<"emails">, insights } : "skip",
    asEmailEvent
  )
}
