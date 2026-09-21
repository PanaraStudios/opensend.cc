"use client"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import type { Domain } from "@/lib/dashboard/types"

export function asDomain(row: Doc<"domains">): Domain {
  return {
    id: row._id,
    name: row.name,
    region: row.region,
    provider: row.dnsProvider,
    status: row.status,
    createdAt: row._creationTime,
    openTracking: false,
    clickTracking: false,
    tls: row.tls,
    customReturnPath: row.customReturnPath,
    receiving: false,
    records: row.records,
    sending: row.sending,
    events: [
      { type: "added", at: row._creationTime },
      ...(row.dnsVerifiedAt
        ? [{ type: "dns_verified" as const, at: row.dnsVerifiedAt }]
        : []),
      ...(row.partiallyVerifiedAt
        ? [{ type: "partially_verified" as const, at: row.partiallyVerifiedAt }]
        : []),
      ...(row.verifiedAt
        ? [{ type: "verified" as const, at: row.verifiedAt }]
        : []),
    ],
  }
}
export function useDomainCommands() {
  const workspace = useWorkspace()
  const create = useMutation(api.domains.create)
  const refresh = useMutation(api.domains.refresh)
  const remove = useMutation(api.domains.remove)
  const update = useMutation(api.domains.update)
  const canWrite =
    workspace.teams.find((t) => t.id === workspace.activeTeamId)?.role ===
    "admin"
  return {
    organizationId: workspace.activeTeamId,
    canWrite,
    addDomain: (input: {
      name: string
      region: Domain["region"]
      customReturnPath: string
    }) => {
      if (!workspace.activeTeamId) throw new Error("Create a team first")
      return create({ ...input, organizationId: workspace.activeTeamId })
    },
    verifyDomain: (id: string) => refresh({ id: id as Id<"domains"> }),
    deleteDomain: (id: string) => remove({ id: id as Id<"domains"> }),
    updateDomain: (
      id: string,
      patch: { tls?: Domain["tls"]; sending?: boolean }
    ) => update({ id: id as Id<"domains">, ...patch }),
  }
}
