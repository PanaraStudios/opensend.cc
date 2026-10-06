"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { PhoneIcon } from "lucide-react"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { IvrMenu, IvrAction } from "@/lib/ivr"
import { BotDiagnostics } from "./bot-diagnostics"
import { DtmfKeypad } from "@/components/dashboard/calling/dtmf-keypad"
import { useSoftphone } from "@/components/dashboard/calling/softphone-provider"
import { EmptyState, OptionSelect } from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { actionError } from "@/lib/action-error"
import { ivrActionLabel } from "@/lib/dashboard/voice-playground"
export function IvrPath({
  path,
  menus = [],
}: {
  path: readonly {
    menuId: string
    digits: string
    action: IvrAction
    at: number
  }[]
  menus?: readonly IvrMenu[]
}) {
  return path.length ? (
    <ol
      aria-label="IVR path"
      className="flex flex-col gap-3 border-l border-border-strong pl-4"
    >
      {path.map((p, i) => (
        <li key={i} className="text-sm">
          <span className="font-medium">
            {menus.find((m) => m.id === p.menuId)?.name ??
              p.menuId.replace(/[-_]/g, " ")}
          </span>
          <span className="block text-muted-foreground">
            {p.digits ? `Pressed ${p.digits}` : "No input"} →{" "}
            {p.action.kind === "submenu"
              ? (menus.find(
                  (m) => p.action.kind === "submenu" && m.id === p.action.menuId
                )?.name ?? "Submenu")
              : ivrActionLabel(p.action)}
          </span>
          <time className="text-xs text-muted-foreground">
            {new Date(p.at).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ol>
  ) : (
    <p className="text-sm text-muted-foreground">
      Your path through the menus will appear here.
    </p>
  )
}
export function VoiceTester({
  kind,
  id,
  name = "your bot",
  menus,
}: {
  kind: "ivr" | "bot"
  id: string
  name?: string
  menus?: IvrMenu[]
}) {
  const { activeTeamId } = useWorkspace()
  return (
    <TeamVoiceTester
      key={activeTeamId}
      kind={kind}
      id={id}
      name={name}
      menus={menus}
    />
  )
}
function TeamVoiceTester({
  kind,
  id,
  name,
  menus = [],
}: {
  kind: "ivr" | "bot"
  id: string
  name: string
  menus?: IvrMenu[]
}) {
  const setup = useTeamQuery(api.calling.playgroundState.setup),
    contacts = useTeamQuery(api.calling.playgroundState.contacts),
    phone = useSoftphone(),
    { activeTeamId } = useWorkspace(),
    health = useAction(api.calling.playground.health)
  const [healthy, setHealthy] = useState<boolean>(),
    [attempt, setAttempt] = useState(0),
    [contactId, setContactId] = useState("none"),
    [accountId, setAccountId] = useState(""),
    [callId, setCallId] = useState<Id<"calls"> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(0)
  const [microphone, setMicrophone] = useState("default"),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([])
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
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setDevices(d.filter((v) => v.kind === "audioinput")))
      .catch(() => undefined)
  }, [])
  const call = useTeamQuery(
    api.calling.playgroundState.detail,
    { id: callId! },
    { enabled: !!callId }
  )
  const live =
    !!call && ["queued", "ringing", "connected"].includes(call.status)
  const unavailable =
    !!setup && (!setup.configured || healthy === false || !setup.numbers.length)
  const ready =
    !!setup?.configured && healthy === true && !!setup.numbers.length
  const currentMenu =
    menus.find(
      (m) =>
        m.id ===
        (call?.ivr_path.at(-1)?.action.kind === "submenu"
          ? (call.ivr_path.at(-1)!.action as { menuId: string }).menuId
          : call?.ivr_path.at(-1)?.menuId)
    ) ?? menus[0]
  async function start() {
    if (!ready) return
    setBusy(true)
    setError("")
    try {
      setCallId(
        await phone.testCall(
          (accountId || setup!.numbers[0].id) as Id<"channelAccounts">,
          kind === "ivr"
            ? { ivrId: id as Id<"ivrs"> }
            : { botId: id as Id<"voiceBots"> },
          contactId === "none" ? undefined : (contactId as Id<"contacts">),
          microphone
        )
      )
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label={kind === "bot" ? "Conversation stage" : "IVR tester"}
      className="flex min-h-[65vh] min-w-0 flex-col p-5"
    >
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-5">
        {!setup ? (
          <Skeleton className="h-32 w-full" />
        ) : unavailable ? (
          <EmptyState
            size="sm"
            icon={PhoneIcon}
            title="Calling stack is not configured"
            description="Connect a WhatsApp number and enable the calling profile with a gateway, trusted WSS and TURN."
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
                  setAttempt((v) => v + 1)
                }}
              >
                Check connection
              </Button>
            ) : null}
          </EmptyState>
        ) : healthy === undefined ? (
          <p
            role="status"
            className="text-center text-sm text-muted-foreground"
          >
            Checking calling connection…
          </p>
        ) : !call ? (
          <EmptyState
            size="sm"
            icon={PhoneIcon}
            title={`Talk to ${name}`}
            description="Start a test call. Speak naturally to interrupt a response."
          />
        ) : (
          <>
            {call.bot_id ? <BotDiagnostics call={call} /> : null}
            {call.ivr_id ? (
              <IvrPath path={call.ivr_path} menus={menus} />
            ) : null}
            <Link
              className="text-sm underline"
              href={`/playground/calls/${call.id}`}
            >
              View call
            </Link>
            {call.error ? (
              <p role="alert" className="text-destructive">
                {call.error}
              </p>
            ) : null}
          </>
        )}
        {kind === "ivr" ? (
          <>
            <p className="text-center text-sm">
              {currentMenu?.prompt.kind === "tts"
                ? currentMenu.prompt.text
                : "Listen to the current prompt."}
            </p>
            <div className="mx-auto w-full max-w-xs">
              <DtmfKeypad
                label="Test DTMF keypad"
                disabled={!live || phone.phase !== "active"}
                send={(digit) => {
                  void phone.dtmf(digit).catch((e) => setError(actionError(e)))
                }}
              />
            </div>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
        {live ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <time aria-label="Call timer" className="text-sm tabular-nums">
              {Math.max(
                0,
                Math.floor(
                  (now - (call.connected_at ?? call.observed_at)) / 1000
                )
              )}
              s
            </time>
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
                void phone.hangup().catch((e) => setError(actionError(e)))
              }
            >
              End call
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>Microphone</FieldLabel>
                <OptionSelect
                  aria-label="Microphone"
                  value={microphone}
                  items={[
                    { value: "default", label: "Default microphone" },
                    ...devices
                      .filter((d) => d.deviceId !== "default")
                      .map((d, i) => ({
                        value: d.deviceId,
                        label: d.label || `Microphone ${i + 1}`,
                      })),
                  ]}
                  onChange={setMicrophone}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel>Test contact</FieldLabel>
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
                  disabled={busy}
                />
              </Field>
              {setup && setup.numbers.length > 1 ? (
                <Field>
                  <FieldLabel>Phone number</FieldLabel>
                  <OptionSelect
                    aria-label="Test number"
                    value={accountId || setup.numbers[0].id}
                    items={setup.numbers.map((n) => ({
                      value: n.id,
                      label: n.label,
                    }))}
                    onChange={setAccountId}
                    disabled={busy}
                  />
                </Field>
              ) : null}
            </div>
            <div className="flex justify-center">
              <Tooltip>
                <TooltipTrigger
                  render={<span tabIndex={unavailable ? 0 : undefined} />}
                >
                  <Button
                    disabled={
                      !ready ||
                      busy ||
                      phone.busy ||
                      phone.working ||
                      phone.connecting
                    }
                    onClick={() => void start()}
                  >
                    {busy ? "Connecting…" : "Start test call"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {unavailable
                    ? "Set up calling before starting a test."
                    : "Start a browser test call"}
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
