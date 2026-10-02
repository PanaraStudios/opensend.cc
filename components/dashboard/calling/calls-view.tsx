"use client"
import Link from "next/link"
import {
  ivrActionLabel,
  callOutcomeLabel,
} from "@/lib/dashboard/voice-playground"
import { useEffect, useState } from "react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  ResourceTable,
  Th,
  RelativeTime,
  EmptyState,
  MetaStrip,
} from "@/components/dashboard/primitives"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { PhoneIcon } from "lucide-react"
import { SoftphoneActions } from "./softphone-provider"
export function CallsView() {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])
  const [after, setAfter] = useState<string>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const log = useTeamQuery(api.calling.rows.dashboardList, { limit: 25, after })
  const ivrs = useTeamQuery(api.ivr.definitions.dashboardList, { limit: 100 })
  const state = useTeamQuery(api.calling.softphoneState.state)
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<SoftphoneActions />}
    >
      <MetaStrip
        items={[
          {
            label: "Agents",
            value: !state ? (
              <Skeleton className="h-4 w-32" />
            ) : state.agents.length === 0 ? (
              "No team members."
            ) : (
              <span className="flex flex-wrap gap-2">
                {state.agents.map((agent) => (
                  <Badge key={agent.userId} variant="secondary">
                    {agent.name} ·{" "}
                    {agent.availableUntil > now ? agent.status : "away"}
                  </Badge>
                ))}
              </span>
            ),
          },
        ]}
      />
      {!log ? (
        <Skeleton className="h-40 w-full" />
      ) : log.data.length === 0 ? (
        <EmptyState
          icon={PhoneIcon}
          title="No calls yet"
          description="WhatsApp voice calls appear here."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Contact</Th>
                <Th className="hidden md:table-cell">Direction</Th>
                <Th className="hidden md:table-cell">Route</Th>
                <Th>Outcome</Th>
                <Th>Duration</Th>
                <Th className="hidden md:table-cell">Started</Th>
              </>
            }
          >
            {log.data.map((call) => (
              <TableRow key={call.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    href={`/playground/calls/${call.id}`}
                  >
                    {call.user_id ?? call.from ?? call.to ?? "Browser"}
                  </Link>
                  {call.test ? (
                    <Badge variant="secondary" className="ml-2">
                      Test
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {call.direction === "inbound" ? "Incoming" : "Outgoing"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {call.bot_id
                    ? `Bot ${call.bot_name ?? ""}`
                    : call.ivr_id
                      ? `IVR ${ivrs?.data.find((i) => i.id === call.ivr_id)?.name ?? ""}`
                      : call.handling_mode === "api"
                        ? "API"
                        : "Agent"}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {call.bot_outcome
                      ? callOutcomeLabel(call.bot_outcome)
                      : call.ivr_outcome
                        ? ivrActionLabel(call.ivr_outcome)
                        : callOutcomeLabel(call.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {call.duration === null ? "—" : `${call.duration}s`}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <RelativeTime at={Date.parse(call.created_at)} />
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!history.length}
              onClick={() => {
                setAfter(history.at(-1))
                setHistory(history.slice(0, -1))
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!log.has_more}
              onClick={() => {
                setHistory([...history, after])
                setAfter(log.data.at(-1)?.id)
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </SectionChrome>
  )
}
