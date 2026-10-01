"use client"
import Link from "next/link"
import {
  ivrActionLabel,
  ivrPathSummary,
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
import { CallEventBubble } from "./call-event-bubble"
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
                <Th>Call</Th>
                <Th>Status</Th>
                <Th>Contact</Th>
                <Th>Outcome</Th>
                <Th>When</Th>
              </>
            }
          >
            {log.data.map((call) => (
              <TableRow key={call.id}>
                <TableCell>
                  <Link href={`/playground/calls/${call.id}`} className="block">
                    <CallEventBubble
                      direction={call.direction}
                      status={call.status}
                      duration={call.duration}
                      time={new Date(call.observed_at).toLocaleTimeString()}
                    />
                  </Link>
                  {call.test ? <Badge variant="secondary">Test</Badge> : null}
                </TableCell>
                <TableCell>{call.status}</TableCell>
                <TableCell>
                  {call.user_id ?? call.from ?? call.to ?? "—"}
                </TableCell>
                <TableCell>
                  <span
                    className="block max-w-sm truncate"
                    title={ivrPathSummary(call.ivr_path)}
                  >
                    {ivrPathSummary(call.ivr_path) || "—"}
                  </span>
                  {call.bot_id ? (
                    <span className="block">
                      {call.bot_name ?? "Voice bot"} ·{" "}
                      {call.bot_outcome ?? "In progress"}
                    </span>
                  ) : null}
                  {call.ivr_outcome ? (
                    <span className="text-sm text-muted-foreground">
                      {call.ivr_outcome.kind === "agents" && call.assigned_agent
                        ? `Transfer to ${state?.agents.find((a) => a.userId === call.assigned_agent)?.name ?? call.assigned_agent}`
                        : ivrActionLabel(call.ivr_outcome)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
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
