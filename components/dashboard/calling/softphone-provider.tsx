"use client"
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useAction, useMutation } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { DtmfKeypad } from "./dtmf-keypad"
import { BrowserPhone, RingSound } from "@/lib/calling/browser"
import {
  softphoneTransition,
  callElapsed,
  callTimer,
  type SoftphonePhase,
} from "@/lib/meta/softphone"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { OptionSelect } from "@/components/dashboard/primitives"
import {
  PhoneIcon,
  MicIcon,
  MicOffIcon,
  PauseIcon,
  PlayIcon,
  PhoneOffIcon,
  ArrowRightLeftIcon,
} from "lucide-react"

interface SoftphoneContext {
  online: boolean
  busy: boolean
  available: boolean
  connecting: boolean
  working: boolean
  callLabel: string
  open: () => void
  toggleOnline: () => void
  currentId: Id<"calls"> | null
  phase: SoftphonePhase
  muted: boolean
  mute: () => void
  dtmf: (digit: string) => Promise<void>
  hangup: () => Promise<void>
  testCall: (
    accountId: Id<"channelAccounts">,
    target: { ivrId: Id<"ivrs"> } | { botId: Id<"voiceBots"> },
    contactId?: Id<"contacts">
  ) => Promise<Id<"calls">>
  outbound: (
    accountId: Id<"channelAccounts">,
    recipient: string
  ) => Promise<void>
}
const Context = createContext<SoftphoneContext | null>(null)
export function useSoftphone() {
  const value = useContext(Context)
  if (!value) throw new Error("Softphone is unavailable")
  return value
}

/** Full controls belong in the page header's actions slot. */
export function SoftphoneActions() {
  const phone = useSoftphone()
  if (!phone.available) return null
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Softphone">
      <Badge variant="secondary">{phone.online ? "Online" : "Away"}</Badge>
      <Button
        disabled={phone.working || phone.connecting}
        onClick={phone.toggleOnline}
      >
        {phone.online ? "Set away" : "Go online"}
      </Button>
      <Button variant="outline" onClick={phone.open}>
        <PhoneIcon data-icon="inline-start" />
        {phone.callLabel}
      </Button>
    </div>
  )
}

/** Keep active/incoming calls reachable without adding a row to every page. */
export function SoftphoneSidebarEntry() {
  const phone = useSoftphone()
  if (!phone.available) return null
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={phone.open}
        aria-label="Open softphone"
        tooltip={`${phone.callLabel} · ${phone.online ? "Online" : "Away"}`}
      >
        <PhoneIcon />
        <span>{phone.callLabel}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const { activeTeamId } = useWorkspace()
  // Team changes dispose the previous team's credentials and microphone.
  return (
    <TeamSoftphone
      key={activeTeamId ?? "none"}
      organizationId={activeTeamId ?? ""}
    >
      {children}
    </TeamSoftphone>
  )
}
function TeamSoftphone({
  organizationId,
  children,
}: {
  organizationId: string
  children: ReactNode
}) {
  const [browserId] = useState(() => crypto.randomUUID())
  const [phase, dispatch] = useReducer(
    softphoneTransition,
    "away" as SoftphonePhase
  )
  const [online, setOnline] = useState(false)
  const [currentId, setCurrentId] = useState<Id<"calls"> | null>(null)
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState("")
  const [queues, setQueues] = useState<string[]>([])
  const [target, setTarget] = useState("")
  const [now, setNow] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const phone = useRef<BrowserPhone | null>(null)
  const ring = useRef<RingSound | null>(null)
  const active = useRef<Id<"calls"> | null>(null)
  const seen = useRef<Id<"calls"> | null>(null)
  const started = useRef(0)
  const expectedLease = useRef("")
  const latest = useRef<Doc<"calls">[]>([])
  const alive = useRef(true)
  const operation = useRef(false)
  const state = useTeamQuery(
    api.calling.softphoneState.state,
    {},
    { enabled: !!organizationId }
  )
  const session = useAction(api.calling.softphone.session)
  const revoke = useAction(api.calling.softphone.revoke)
  const answerAction = useAction(api.calling.softphone.answer)
  const hangupAction = useAction(api.calling.softphone.hangup)
  const outboundAction = useAction(api.calling.softphone.outbound)
  const startTest = useAction(api.calling.playground.start)
  const hangupTest = useAction(api.calling.playground.hangup)
  const testCallId = useRef<Id<"calls"> | null>(null)
  const controlAction = useAction(api.calling.softphone.control)
  const presence = useMutation(api.calling.softphoneState.presence)
  const claim = useMutation(api.calling.softphoneState.claim)
  const release = useMutation(api.calling.softphoneState.release)
  const args = { organizationId, browserId }
  const current = state?.calls.find((c) => c._id === currentId)
  const incoming =
    online && !currentId
      ? state?.calls.find(
          (c) =>
            c.direction === "inbound" &&
            !c.assignedAgent &&
            ["queued", "ringing"].includes(c.status) &&
            (c.offeredAt ?? c._creationTime) + 60000 > now
        )
      : undefined
  const working = ["registering", "claiming", "ending"].includes(phase)

  function reset() {
    active.current = null
    testCallId.current = null
    seen.current = null
    setCurrentId(null)
    setMuted(false)
    setTarget("")
    dispatch("ended")
  }
  function fail(reason: unknown, fatal = false) {
    const message = reason instanceof Error ? reason.message : "Calling failed"
    if (alive.current) {
      setError(message)
      toast.add({ type: "error", title: message })
      if (fatal) dispatch("fail")
    }
  }
  async function goAway() {
    operation.current = true
    const browser = phone.current
    phone.current = null
    try {
      if (active.current)
        await (testCallId.current ? hangupTest : hangupAction)({
          ...args,
          id: active.current,
        })
    } catch (reason) {
      fail(reason)
    } finally {
      // A signaling/auth failure must still stop the microphone and SIP socket.
      await presence({ ...args, status: "away" }).catch(() => undefined)
      await browser?.close()
      await revoke(args).catch(() => undefined)
      ring.current?.stop()
      if (alive.current) {
        setOnline(false)
        reset()
        dispatch("away")
      }
      operation.current = false
    }
  }
  async function goOnline() {
    if (operation.current || !organizationId) return
    operation.current = true
    dispatch("online")
    setError("")
    let credential: Awaited<ReturnType<typeof session>> | undefined
    try {
      ring.current ??= new RingSound()
      await ring.current.arm()
      credential = await session(args)
      if (!alive.current) {
        await revoke(args)
        return
      }
      expectedLease.current = credential.leaseId
      setQueues(credential.queues)
      const browser = (phone.current = new BrowserPhone(audio.current!, {
        invite: async () => {
          // A transfer INVITE may precede the Convex subscription update. Wait for
          // the authorized connected call; never answer an arbitrary SIP invite.
          for (let i = 0; i < 40 && alive.current; i++) {
            const call = latest.current.find(
              (c) =>
                (c.agentLeaseId === expectedLease.current ||
                  (c.test && c.testBrowserId === browserId)) &&
                c.status === "connected"
            )
            if (call) {
              active.current = call._id
              started.current = Date.now()
              dispatch("answer")
              setCurrentId(call._id)
              if (call.test) testCallId.current = call._id
              else setOpen(true)
              return true
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          return false
        },
        connected: () => {
          if (alive.current) {
            dispatch("connected")
            if (!testCallId.current) setOpen(true)
          }
        },
        ended: () => {
          if (alive.current) reset()
        },
        failed: (reason) => {
          fail(reason, true)
          void goAway().catch(() => undefined)
        },
      }))
      await browser.microphone()
      await browser.register(credential)
      if (!alive.current) {
        await browser.close()
        await revoke(args)
        return
      }
      await presence({ ...args, status: "online" })
      setOnline(true)
      dispatch("registered")
    } catch (reason) {
      await phone.current?.close()
      phone.current = null
      if (credential) await revoke(args).catch(() => undefined)
      fail(reason, true)
    } finally {
      operation.current = false
    }
  }
  async function answer(id: Id<"calls">) {
    if (operation.current || !phone.current) return
    operation.current = true
    dispatch("answer")
    ring.current?.stop()
    setError("")
    let claimed = false
    try {
      await claim({ ...args, id })
      claimed = true
      await phone.current.microphone()
      active.current = id
      started.current = Date.now()
      setCurrentId(id)
      dispatch("claimed")
      await answerAction({ ...args, id })
    } catch (reason) {
      if (claimed) await release({ ...args, id }).catch(() => undefined)
      reset()
      fail(reason)
    } finally {
      operation.current = false
    }
  }
  async function outbound(accountId: Id<"channelAccounts">, recipient: string) {
    if (!online || active.current || operation.current || !phone.current)
      throw new Error("Go online and finish your current call first")
    operation.current = true
    dispatch("answer")
    setError("")
    setOpen(true)
    try {
      await phone.current.microphone()
      const id = await outboundAction({ ...args, accountId, recipient })
      if (!alive.current) {
        await hangupAction({ ...args, id })
        return
      }
      active.current = id
      started.current = Date.now()
      setCurrentId(id)
      dispatch("claimed")
    } catch (reason) {
      reset()
      fail(reason)
      throw reason
    } finally {
      operation.current = false
    }
  }
  async function hangup() {
    if (!active.current || operation.current) return
    operation.current = true
    dispatch("hangup")
    try {
      await (testCallId.current ? hangupTest : hangupAction)({
        ...args,
        id: active.current,
      })
      await phone.current?.hangup()
      reset()
    } catch (reason) {
      fail(reason)
    } finally {
      operation.current = false
    }
  }
  async function control(operationName: "hold" | "resume" | "transfer") {
    if (!active.current || operation.current) return
    operation.current = true
    try {
      await controlAction({
        ...args,
        id: active.current,
        operation: operationName,
        ...(operationName === "transfer"
          ? target.startsWith("queue:")
            ? { queue: target.slice(6) }
            : { agentId: target as Id<"callAgents"> }
          : {}),
      })
      if (operationName === "transfer") reset()
      else dispatch(operationName)
    } catch (reason) {
      fail(reason)
    } finally {
      operation.current = false
    }
  }
  useEffect(() => {
    latest.current = state?.calls ?? []
  }, [state])
  useEffect(() => {
    alive.current = true
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive.current = false
      clearInterval(tick)
      ring.current?.close()
      if (active.current)
        void (testCallId.current ? hangupTest : hangupAction)({
          organizationId,
          browserId,
          id: active.current,
        }).catch(() => undefined)
      void phone.current?.close()
      if (phone.current)
        void revoke({ organizationId, browserId }).catch(() => undefined)
    }
  }, [organizationId, browserId, hangupAction, hangupTest, revoke])
  useEffect(() => {
    if (!online) return
    let stopped = false,
      renewing = false
    const heartbeat = setInterval(() => {
      if (renewing) return
      renewing = true
      void (async () => {
        const credential = await session({ organizationId, browserId })
        if (stopped) return
        if (credential.leaseId !== expectedLease.current)
          throw new Error("Agent session expired; go online again")
        await presence({ organizationId, browserId, status: "online" })
      })()
        .catch((reason) => {
          if (!stopped) {
            fail(reason)
            void goAway().catch(() => undefined)
          }
        })
        .finally(() => {
          renewing = false
        })
    }, 30000)
    return () => {
      stopped = true
      clearInterval(heartbeat)
    }
    // Session callbacks use only this mounted team's stable args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, organizationId, browserId, session, presence])
  useEffect(() => {
    if (!incoming) {
      if (!active.current && !operation.current) dispatch("ended")
      return
    }
    dispatch("incoming")
    ring.current?.start()
    const id = toast.add({
      title: "Incoming voice call",
      description: incoming.from ?? incoming.userId ?? "WhatsApp caller",
      timeout: 0,
      actionProps: { children: "View call", onClick: () => setOpen(true) },
    })
    return () => {
      ring.current?.stop()
      toast.close(id)
    }
  }, [incoming?._id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!currentId || !state) return
    const owned = state.calls.some(
      (c) =>
        c._id === currentId &&
        (c.agentLeaseId === expectedLease.current ||
          (c.test && c.testBrowserId === browserId))
    )
    if (owned) {
      seen.current = currentId
      return
    }
    if (seen.current === currentId || (now && now - started.current > 60000)) {
      // Covers remote termination and transfers. Do not terminate a transferred call.
      active.current = null
      void phone.current?.hangup().catch(() => undefined)
      reset()
    }
  }, [state, currentId, now, browserId])
  const transferItems = [
    ...(state?.agents ?? [])
      .filter(
        (a) =>
          a.id !== null &&
          a.status === "online" &&
          a.availableUntil > now &&
          a.userId !== current?.assignedAgent
      )
      .map((a) => ({ value: a.id!, label: a.name })),
    ...queues.map((q) => ({ value: `queue:${q}`, label: `Queue: ${q}` })),
  ]
  return (
    <Context.Provider
      value={{
        online,
        busy: !!currentId || working || phase === "connecting",
        available: !!organizationId,
        connecting: phase === "connecting",
        working,
        callLabel: incoming
          ? "Incoming call"
          : currentId
            ? "Current call"
            : "Softphone",
        open: () => setOpen(true),
        toggleOnline: () => {
          void (online ? goAway() : goOnline()).catch(fail)
        },
        currentId,
        phase,
        muted,
        mute: () => {
          phone.current?.mute(!muted)
          setMuted(!muted)
        },
        dtmf: async (digit) => {
          await phone.current?.dtmf(digit)
        },
        hangup,
        testCall: async (accountId, target, contactId) => {
          if (!online || active.current || operation.current || !phone.current)
            throw new Error("Go online and finish your current call first")
          operation.current = true
          try {
            await phone.current.microphone()
            return await startTest({ ...args, accountId, ...target, contactId })
          } finally {
            operation.current = false
          }
        },
        outbound,
      }}
    >
      <audio ref={audio} autoPlay aria-label="Call audio" />
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {incoming ? "Incoming voice call" : "Voice call"}
            </DialogTitle>
            <DialogDescription>
              {incoming?.from ??
                incoming?.userId ??
                current?.to ??
                current?.from ??
                "Browser softphone"}
            </DialogDescription>
          </DialogHeader>
          <p role="status">
            {currentId
              ? `${phase} · ${callTimer(callElapsed(current?.connectedAt, now))}`
              : online
                ? "Ready for calls"
                : "Go online to receive and make calls"}
          </p>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {incoming ? (
            <Button
              disabled={working}
              onClick={() => {
                void answer(incoming._id)
              }}
            >
              <PhoneIcon />
              Answer
            </Button>
          ) : null}
          {currentId ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!["active", "held"].includes(phase)}
                  aria-pressed={muted}
                  onClick={() => {
                    phone.current?.mute(!muted)
                    setMuted(!muted)
                  }}
                >
                  {muted ? <MicOffIcon /> : <MicIcon />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!["active", "held"].includes(phase)}
                  aria-pressed={phase === "held"}
                  onClick={() => {
                    void control(phase === "held" ? "resume" : "hold")
                  }}
                >
                  {phase === "held" ? <PlayIcon /> : <PauseIcon />}
                  {phase === "held" ? "Resume" : "Hold"}
                </Button>
                <Button
                  variant="destructive"
                  disabled={working}
                  onClick={() => {
                    void hangup()
                  }}
                >
                  <PhoneOffIcon />
                  Hang up
                </Button>
              </div>
              <div className="flex gap-2">
                <OptionSelect
                  aria-label="Transfer to agent or queue"
                  placeholder="Agent or queue"
                  value={target}
                  onChange={setTarget}
                  items={transferItems}
                />
                <Button
                  variant="outline"
                  disabled={!target || !["active", "held"].includes(phase)}
                  onClick={() => {
                    void control("transfer")
                  }}
                >
                  <ArrowRightLeftIcon />
                  Transfer
                </Button>
              </div>
              <DtmfKeypad
                disabled={phase !== "active"}
                send={(digit) => {
                  void phone.current?.dtmf(digit).catch(fail)
                }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Context.Provider>
  )
}
