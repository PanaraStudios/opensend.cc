"use client"
import Link from "next/link"
import {
  ivrActionLabel,
  callOutcomeLabel,
  callRouteLabel,
} from "@/lib/dashboard/voice-playground"
import { agentPresenceLabel, hasAgentRoute } from "@/lib/meta/softphone"
import {
  cursorListIsEmpty,
  cursorNext,
  cursorPagerVisible,
  cursorPrevious,
} from "@/lib/dashboard/pagination"
import { pickerSelectedIds } from "@/lib/dashboard/options"
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
  DocsButton,
} from "@/components/dashboard/primitives"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { CALLING_DOCS_HREF } from "@/lib/docs-links"
import { PhoneIcon } from "lucide-react"
import { SoftphoneActions } from "./softphone-provider"
export function CallsView() {
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, 5000)
    return () => clearInterval(timer)
  }, [])
  const [after, setAfter] = useState<string>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const log = useTeamQuery(api.calling.rows.dashboardList, { limit: 25, after })
  const ivrs = useTeamQuery(
    api.ivr.definitions.options,
    {
      selectedIds: pickerSelectedIds(
        (log?.data ?? []).map((call) => call.ivr_id)
      ),
    },
    { enabled: !!log }
  )
  const state = useTeamQuery(api.calling.softphoneState.state)
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<SoftphoneActions />}
    >
      {setup && !setup.configured ? (
        <EmptyState
          size="sm"
          icon={PhoneIcon}
          title="Calling is not configured"
          description={
            setup.routingConfigured
              ? "Ask your instance administrator to configure the calling gateway’s trusted secure browser connection before going online. TURN is only needed when your browser’s network requires an audio relay."
              : "Ask your instance administrator to configure the calling gateway and its credentials, then a trusted secure browser connection, before going online. TURN is only needed when your browser’s network requires an audio relay."
          }
        >
          <DocsButton href={CALLING_DOCS_HREF} />
        </EmptyState>
      ) : setup && !hasAgentRoute(setup.numbers) ? (
        <EmptyState
          size="sm"
          icon={PhoneIcon}
          title="Set up a softphone channel"
          description="Choose Media gateway and route calls to team agents in your WhatsApp channel’s Calling settings to use the softphone."
        >
          <Button nativeButton={false} render={<Link href="/channels" />}>
            Open Channels
          </Button>
        </EmptyState>
      ) : null}
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
                    {agentPresenceLabel(
                      agent.status,
                      agent.availableUntil,
                      now
                    )}
                  </Badge>
                ))}
              </span>
            ),
          },
        ]}
      />
      {!log ? (
        <Skeleton className="h-40 w-full" />
      ) : cursorListIsEmpty(log.data.length, history) ? (
        <EmptyState
          icon={PhoneIcon}
          title="No calls yet"
          description="WhatsApp voice calls appear here."
        />
      ) : (
        <>
          {log.data.length ? (
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
                      {call.contact_name}
                    </Link>
                    {call.contact_phone ? (
                      <div className="text-xs text-muted-foreground">
                        {call.contact_phone}
                      </div>
                    ) : null}
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
                    {callRouteLabel(call, ivrs)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {call.direction === "outbound" && call.outcome
                        ? callOutcomeLabel(call.outcome)
                        : call.bot_outcome
                          ? callOutcomeLabel(call.bot_outcome)
                          : call.ivr_outcome
                            ? ivrActionLabel(call.ivr_outcome)
                            : callOutcomeLabel(call.status)}
                    </Badge>
                    {call.error ? (
                      <p className="mt-1 max-w-xs text-xs text-destructive">
                        {call.error}
                      </p>
                    ) : null}
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
          ) : (
            <p className="text-sm text-muted-foreground">
              No calls on this page.
            </p>
          )}
          {cursorPagerVisible(history, log.has_more) ? (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!history.length}
                onClick={() => {
                  const previous = cursorPrevious({ after, history })
                  setAfter(previous.after)
                  setHistory([...previous.history])
                }}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!log.has_more}
                onClick={() => {
                  const next = cursorNext(
                    { after, history },
                    log.data.at(-1)?.id
                  )
                  setAfter(next.after)
                  setHistory([...next.history])
                }}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SectionChrome>
  )
}
