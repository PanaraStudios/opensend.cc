"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { PhoneIcon } from "lucide-react"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { BotDiagnostics } from "./bot-diagnostics"
import { DtmfKeypad } from "@/components/dashboard/calling/dtmf-keypad"
import { useSoftphone } from "@/components/dashboard/calling/softphone-provider"
import {
  DetailSection,
  EmptyState,
  OptionSelect,
  MetaStrip,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
import { ivrActionLabel } from "@/lib/dashboard/voice-playground"
export function IvrPath({
  path,
}: {
  path: readonly {
    menuId: string
    digits: string
    action: import("@/lib/ivr").IvrAction
    at: number
  }[]
}) {
  return path.length ? (
    <ResourceTable
      headers={
        <>
          <Th>Menu</Th>
          <Th>Input</Th>
          <Th>Action</Th>
          <Th>Time</Th>
        </>
      }
    >
      {path.map((p, i) => (
        <TableRow key={i}>
          <TableCell>{p.menuId}</TableCell>
          <TableCell>{p.digits}</TableCell>
          <TableCell>{ivrActionLabel(p.action)}</TableCell>
          <TableCell>{new Date(p.at).toLocaleTimeString()}</TableCell>
        </TableRow>
      ))}
    </ResourceTable>
  ) : (
    <p className="text-sm text-muted-foreground">Waiting for menu input…</p>
  )
}
export function VoiceTester({ kind, id }: { kind: "ivr" | "bot"; id: string }) {
  const { activeTeamId } = useWorkspace()
  return <TeamVoiceTester key={activeTeamId} kind={kind} id={id} />
}
function TeamVoiceTester({ kind, id }: { kind: "ivr" | "bot"; id: string }) {
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  const contacts = useTeamQuery(api.calling.playgroundState.contacts)
  const [contactId, setContactId] = useState("none")
  const phone = useSoftphone()
  const { activeTeamId } = useWorkspace()
  const health = useAction(api.calling.playground.health)
  const [healthy, setHealthy] = useState<boolean | undefined>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    if (setup?.configured && activeTeamId)
      void health({ organizationId: activeTeamId })
        .then((ok) => {
          if (alive) setHealthy(ok)
        })
        .catch(() => {
          if (alive) setHealthy(false)
        })
    return () => {
      alive = false
    }
  }, [setup?.configured, activeTeamId, health, attempt])
  const [accountId, setAccountId] = useState("")
  const [callId, setCallId] = useState<Id<"calls"> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const call = useTeamQuery(
    api.calling.playgroundState.detail,
    { id: callId! },
    { enabled: !!callId }
  )
  const live =
    !!call && ["queued", "ringing", "connected"].includes(call.status)
  return (
    <DetailSection title="Test call">
      {!setup ? (
        <Skeleton className="h-32 w-full" />
      ) : !setup.configured || healthy === false || !setup.numbers.length ? (
        <EmptyState
          size="sm"
          icon={PhoneIcon}
          title="Calling stack is not configured"
          description="Connect a WhatsApp number, enable the calling profile and configure the gateway, trusted FreeSWITCH WSS and TURN for your browser network."
        >
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link
                href="https://github.com/PanaraStudios/opensend.cc/blob/v2/docs/browser-softphone.md"
                target="_blank"
              />
            }
          >
            Calling setup documentation
          </Button>
          {setup.configured ? (
            <Button
              variant="outline"
              onClick={() => {
                setHealthy(undefined)
                setAttempt((value) => value + 1)
              }}
            >
              Check connection
            </Button>
          ) : null}
        </EmptyState>
      ) : healthy === undefined ? (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Checking calling connection…
          </p>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Your browser plays the caller through the same FreeSWITCH IVR and
            voice engine. Test calls are excluded from customer webhooks and
            budgets. Speaking interrupts a bot response.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <OptionSelect
              aria-label="Test contact"
              value={contactId}
              items={[
                { value: "none", label: "No test contact" },
                ...(contacts ?? []).map((c) => ({
                  value: c.id,
                  label: c.label,
                })),
              ]}
              onChange={setContactId}
              disabled={live || busy}
            />
            <OptionSelect
              aria-label="Test number"
              value={accountId}
              placeholder="Choose a number"
              items={setup.numbers.map((n) => ({
                value: n.id,
                label: n.label,
              }))}
              onChange={setAccountId}
              disabled={live || busy}
            />
            <Button
              variant="outline"
              disabled={
                phone.busy || phone.working || phone.connecting || live || busy
              }
              onClick={phone.toggleOnline}
            >
              {phone.online ? "Set away" : "Go online"}
            </Button>
            <Button
              disabled={
                !phone.online || phone.busy || !accountId || live || busy
              }
              onClick={async () => {
                setBusy(true)
                setError("")
                try {
                  setCallId(
                    await phone.testCall(
                      accountId as Id<"channelAccounts">,
                      kind === "ivr"
                        ? { ivrId: id as Id<"ivrs"> }
                        : { botId: id as Id<"voiceBots"> },
                      contactId === "none"
                        ? undefined
                        : (contactId as Id<"contacts">)
                    )
                  )
                } catch (e) {
                  setError(actionError(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy
                ? "Connecting…"
                : kind === "ivr"
                  ? "Test IVR"
                  : "Test voice bot"}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {call ? (
            <>
              <MetaStrip
                items={[
                  { label: "Status", value: call.status },
                  { label: "Outcome", value: ivrActionLabel(call.ivr_outcome) },
                  {
                    label: "Call",
                    value: (
                      <Link
                        href={`/playground/calls/${call.id}`}
                        className="font-medium hover:underline"
                      >
                        View test call
                      </Link>
                    ),
                  },
                ]}
              />
              {live ? (
                <>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      aria-pressed={phone.muted}
                      onClick={phone.mute}
                    >
                      {phone.muted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() =>
                        void phone
                          .hangup()
                          .catch((e) => setError(actionError(e)))
                      }
                    >
                      Hang up
                    </Button>
                  </div>
                  <DtmfKeypad
                    label="Test DTMF keypad"
                    disabled={phone.phase !== "active"}
                    send={(digit) => {
                      void phone
                        .dtmf(digit)
                        .catch((e) => setError(actionError(e)))
                    }}
                  />
                </>
              ) : null}
              {call.ivr_id ? <IvrPath path={call.ivr_path} /> : null}
              {call.bot_id ? <BotDiagnostics call={call} /> : null}
              {call.error ? (
                <p role="alert" className="text-destructive">
                  {call.error}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </DetailSection>
  )
}
