"use client"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { useTeamList } from "@/components/dashboard/primitives"
import { useTeamQuery } from "@/components/auth/workspace"
import type { ReceivedEmail } from "@/lib/dashboard/types"

export function asReceived(
  row: Doc<"receivedEmails">,
  content?: Doc<"receivedContents"> | null
): ReceivedEmail {
  return {
    id: row._id,
    from: row.from,
    to: row.to.join(", "),
    subject: row.subject,
    createdAt: row.receivedAt,
    html: content?.html ?? "",
    text: content?.text ?? "",
  }
}
export function useReceivedList(filters: {
  search?: string
  from?: number
  to?: number
  address?: string
}) {
  return useTeamList(api.received.list, api.received.count, filters, asReceived)
}
export function useReceived(id: string) {
  const result = useQuery(api.received.get, { id })
  return result ? asReceived(result.email, result.content) : result
}
export function useReceivingDomain() {
  return useTeamQuery(api.received.receivingDomain, {})
}
