"use client"
import {
  ListPagination,
  PAGE_SIZES,
  useLoadedPagination,
} from "@/components/dashboard/primitives"
import { useMutation, useQuery, usePaginatedQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { AsyncForm } from "@/components/auth/ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

export function TeamSesStatus({ organizationId }: { organizationId: string }) {
  const tenants = useQuery(api.tenants.list, { organizationId })
  const retry = useMutation(api.tenants.retry)
  if (!tenants?.length) return null
  return (
    <div className="flex flex-col gap-3">
      {tenants
        .filter((tenant) => !tenant.deleted && tenant.operation === "provision")
        .map((tenant) => (
          <div key={tenant._id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Team email setup</span>
              <Badge
                variant={tenant.phase === "ready" ? "success" : "secondary"}
              >
                {tenant.phase === "running"
                  ? "Setting up…"
                  : tenant.phase === "ready"
                    ? "Ready"
                    : "Needs attention"}
              </Badge>
            </div>
            {tenant.error && (
              <Alert variant="destructive">
                <AlertDescription>{tenant.error}</AlertDescription>
              </Alert>
            )}
            {tenant.phase === "failed" && (
              <AsyncForm
                submitLabel="Retry tenant setup"
                success={false}
                onSubmit={() =>
                  retry({ organizationId, region: tenant.region })
                }
              />
            )}
          </div>
        ))}
    </div>
  )
}
export function TenantCleanup() {
  const query = usePaginatedQuery(
    api.tenants.cleanup,
    {},
    { initialNumItems: PAGE_SIZES[0] }
  )
  const { pageRows: rows, pagination } = useLoadedPagination(
    query.results,
    query
  )
  const retry = useMutation(api.tenants.retryCleanup)
  if (!rows?.length) return null
  return (
    <Alert variant="warning">
      <AlertTitle>Some team tenants still need cleanup</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row._id} className="flex flex-col gap-2">
              <p className="break-all">
                {row.name} · {row.region}
              </p>
              <p>{row.error}</p>
              <AsyncForm
                submitLabel="Retry tenant cleanup"
                success={false}
                onSubmit={() => retry({ id: row._id })}
              />
            </div>
          ))}
          <ListPagination {...pagination} noun="tenant" />
        </div>
      </AlertDescription>
    </Alert>
  )
}
