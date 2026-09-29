"use client"
import * as React from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useTeamRole, useWorkspace } from "@/components/auth/workspace"
import { toast } from "@/components/ui/toast"
import { domainCheckResult } from "@/lib/dashboard/domains"
import type { Domain } from "@/lib/dashboard/types"

export function asDomain(row: Doc<"domains">): Domain {
  return {
    id: row._id,
    name: row.name,
    claiming: !!row.claimId,
    region: row.region,
    provider: row.dnsProvider,
    status: row.status,
    createdAt: row._creationTime,
    openTracking: row.openTracking ?? false,
    clickTracking: row.clickTracking ?? false,
    trackingSubdomain: row.trackingSubdomain,
    trackingTarget: row.trackingTarget,
    tls: row.tls,
    customReturnPath: row.customReturnPath,
    receiving: row.receiving ?? false,
    records: row.records,
    sending: row.sending,
    checking: row.checking ?? false,
    ...(row.domainConnect
      ? {
          autoConfigure: {
            providerName: row.domainConnect.providerName,
            width: row.domainConnect.width,
            height: row.domainConnect.height,
          },
        }
      : {}),
    dnsVerifiedAt: row.dnsVerifiedAt,
    partiallyVerifiedAt: row.partiallyVerifiedAt,
    verifiedAt: row.verifiedAt,
  }
}
export function useDomainCommands() {
  const workspace = useWorkspace()
  const create = useMutation(api.domains.create)
  const claim = useMutation(api.domainClaims.create)
  const verify = useMutation(api.domains.verify)
  const remove = useMutation(api.domains.remove)
  const update = useMutation(api.domains.update)
  const applyUrl = useAction(api.ses.domainConnect.apply)
  const { canWrite } = useTeamRole()
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
    claimDomain: (input: {
      name: string
      region: Domain["region"]
      customReturnPath: string
    }) => {
      if (!workspace.activeTeamId) throw new Error("Create a team first")
      return claim({ ...input, organizationId: workspace.activeTeamId })
    },
    verifyDomain: (id: string) => verify({ id: id as Id<"domains"> }),
    deleteDomain: (id: string) => remove({ id: id as Id<"domains"> }),
    updateDomain: (
      id: string,
      patch: Partial<
        Pick<
          Domain,
          | "tls"
          | "sending"
          | "receiving"
          | "trackingSubdomain"
          | "openTracking"
          | "clickTracking"
        >
      >
    ) => update({ id: id as Id<"domains">, ...patch }),
    /** The DNS provider's own page, with every record filled in. */
    autoConfigureUrl: (id: string) => applyUrl({ id: id as Id<"domains"> }),
  }
}

/** "Check DNS records" for the `domains` on screen. The check runs on the
    server and sets `checking` until its result is saved; once a check started
    here finishes, a toast says what it found. */
export function useDomainCheck(domains: Domain[]) {
  const { verifyDomain } = useDomainCommands()
  const waiting = React.useRef(new Set<string>())
  React.useEffect(() => {
    for (const domain of domains) {
      if (!waiting.current.has(domain.id) || domain.checking) continue
      waiting.current.delete(domain.id)
      toast.add(domainCheckResult(domain))
    }
  }, [domains])
  return async (id: string) => {
    // Convex settles a mutation only once queries show its writes, so the
    // domain already reads `checking` by now. A failed domain retries its
    // operation instead, which reports through the domain's phase.
    if (await verifyDomain(id)) waiting.current.add(id)
  }
}

/** Bounded options for the existing dropdowns and command search. */
export function useDomainOptions(
  filters: {
    search?: string
    status?: Doc<"domains">["status"]
    selectedId?: Id<"domains">
  } = {},
  enabled = true
) {
  const { activeTeamId } = useWorkspace()
  const page = useQuery(
    api.domains.options,
    activeTeamId && enabled
      ? {
          organizationId: activeTeamId,
          ...filters,
        }
      : "skip"
  )
  return React.useMemo(() => page?.map(asDomain) ?? [], [page])
}
export function useDomain(id: string | null | undefined) {
  const row = useQuery(api.domains.get, id ? { id } : "skip")
  return row ? asDomain(row.domain) : row
}
export function useDomainByName(name: string | undefined) {
  const { activeTeamId } = useWorkspace()
  const row = useQuery(
    api.domains.byName,
    activeTeamId && name ? { organizationId: activeTeamId, name } : "skip"
  )
  return row ? asDomain(row) : row
}
