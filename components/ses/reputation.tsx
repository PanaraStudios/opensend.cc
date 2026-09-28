"use client"
import * as React from "react"
import { useAction } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { PauseIcon, PlayIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { useClock } from "@/lib/time/use-clock"
import {
  percent,
  tenantStatusLabel,
  TENANT_STATUS_TONE,
} from "@/lib/dashboard/format"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  SettingsCard,
  ResourceTable,
  Th,
  MoreMenu,
  ConfirmDialog,
  ListPagination,
  usePagedList,
} from "@/components/dashboard/primitives"

type TeamRow = FunctionReturnType<
  typeof api.ses.reputation.list
>["page"][number]
const asTeam = (row: TeamRow) => row
const enabled = (status?: string) =>
  status === "ENABLED" || status === "REINSTATED"

export function TenantReputation() {
  const now = useClock()
  const list = usePagedList(
    api.ses.reputation.list,
    api.ses.reputation.count,
    {},
    asTeam
  )
  const setPaused = useAction(api.ses.reputationActions.setPaused)
  const [pending, setPending] = React.useState<TeamRow | null>(null)
  const pause = enabled(pending?.tenant.sendingStatus)
  return (
    <SettingsCard
      title="Team sending"
      description="Per-region sending status. Volume and recipient bounce and complaint rates are calculated from Opensend events over the last 24 hours; AWS uses its own evaluation window."
      footer={<ListPagination noun="tenant" {...list.pagination} />}
    >
      {list.status === "LoadingFirstPage" ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Team</Th>
              <Th>Status</Th>
              <Th>Volume</Th>
              <Th>Bounce rate</Th>
              <Th>Complaint rate</Th>
              <Th className="w-12" />
            </>
          }
        >
          {list.pageRows.map((row) => (
            <TableRow key={row.tenant._id}>
              <TableCell>
                <div>{row.name}</div>
                <div className="text-xs text-muted-foreground">
                  {row.tenant.region}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    TENANT_STATUS_TONE[row.tenant.sendingStatus ?? "UNKNOWN"] ??
                    "warning"
                  }
                  dot
                >
                  {tenantStatusLabel(row.tenant.sendingStatus)}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{row.volume}</TableCell>
              <TableCell className="tabular-nums">
                {percent(row.bounced, row.volume, 2)}
              </TableCell>
              <TableCell className="tabular-nums">
                {percent(row.complained, row.volume, 2)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      disabled={
                        row.tenant.phase !== "ready" ||
                        (!!row.tenant.statusOperation &&
                          (now ?? 0) - (row.tenant.statusOperationAt ?? 0) <
                            300000)
                      }
                      onClick={() => setPending(row)}
                    >
                      {enabled(row.tenant.sendingStatus) ? (
                        <PauseIcon />
                      ) : (
                        <PlayIcon />
                      )}
                      {enabled(row.tenant.sendingStatus) ? "Pause" : "Resume"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={`${pause ? "Pause" : "Resume"} sending for ${pending?.name ?? ""}?`}
        description={
          pause
            ? "Queued emails in this region will fail while sending is paused. Emails already accepted by AWS can still be delivered."
            : "Allow new sends in this region. An AWS sending restriction will still apply. Failed emails are not retried automatically."
        }
        confirmLabel={pause ? "Pause" : "Resume"}
        onConfirm={async () => {
          if (pending)
            await setPaused({ id: pending.tenant._id, paused: pause })
        }}
      />
    </SettingsCard>
  )
}
