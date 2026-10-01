"use client"
import { useEffect, useState } from "react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  ResourceTable,
  Th,
  RelativeTime,
  EmptyState,
} from "@/components/dashboard/primitives"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EMAIL_TABS } from "@/lib/dashboard/nav"
import { PhoneIcon } from "lucide-react"
import { CallEventBubble } from "./call-event-bubble"
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
    <SectionChrome title="Messages" tabs={EMAIL_TABS}>
      <section className="flex flex-col gap-3" aria-label="Agent presence">
        <h2 className="text-sm font-medium">Agents</h2>
        <div className="flex flex-wrap gap-2">
          {state?.agents.map((agent) => (
            <Badge key={agent.userId} variant="secondary">
              {agent.name} ·{" "}
              {agent.availableUntil > now ? agent.status : "away"}
            </Badge>
          ))}
          {state?.agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members.</p>
          ) : null}
        </div>
      </section>
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
                <Th>When</Th>
              </>
            }
          >
            {log.data.map((call) => (
              <TableRow key={call.id}>
                <TableCell>
                  <CallEventBubble
                    direction={call.direction}
                    status={call.status}
                    duration={call.duration}
                    time={new Date(call.observed_at).toLocaleTimeString()}
                  />
                </TableCell>
                <TableCell>{call.status}</TableCell>
                <TableCell>
                  {call.user_id ?? call.from ?? call.to ?? "—"}
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
