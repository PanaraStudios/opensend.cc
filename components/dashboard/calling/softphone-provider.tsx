"use client"
import Link from "next/link"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel } from "@/components/ui/field"
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
import { FloatingCallCard } from "./call-card"
import { MicrophonePicker } from "./microphone-picker"
import {
  callCardTransition,
  emptyCallCard,
  ownsSoftphone,
} from "@/lib/meta/call-card"
import { actionError } from "@/lib/action-error"
import {
  browserIceServers,
  iceNeedsRefresh,
  usesTurn,
  type IceConfiguration,
} from "@/lib/calling/ice"
import { BrowserPhone, RingSound } from "@/lib/calling/browser"
import {
  softphoneTransition,
  callElapsed,
  callTimer,
  offerIsFresh,
  presenceIsCurrent,
  hasAgentRoute,
  type SoftphonePhase,
} from "@/lib/meta/softphone"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverTitle,
} from "@/components/ui/popover"
import { toast } from "@/components/ui/toast"
import { PhoneIcon } from "lucide-react"

interface SoftphoneContext {
  panelOpen: boolean
  setPanelOpen: (value: boolean) => void
  panel: ReactNode
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
    contactId?: Id<"contacts">,
    microphoneId?: string
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
  const { setOpenMobile } = useSidebar()
  const { callLabel, setPanelOpen } = phone
  useEffect(() => {
    if (callLabel !== "Incoming call") return
    const frame = requestAnimationFrame(() => {
      setPanelOpen(false)
      setOpenMobile(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [callLabel, setPanelOpen, setOpenMobile])
  if (!phone.available) return null
  return (
    <SidebarMenuItem>
      <Popover open={phone.panelOpen} onOpenChange={phone.setPanelOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              aria-label="Open softphone"
              tooltip={`Softphone · ${phone.online ? "Online" : "Away"}`}
            />
          }
        >
          <PhoneIcon />
          <span>Softphone</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {phone.online ? "Online" : "Away"}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4"
        >
          <PopoverTitle>Softphone</PopoverTitle>
          {phone.panel}
        </PopoverContent>
      </Popover>
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
  const [card, cardDispatch] = useReducer(callCardTransition, emptyCallCard)
  const [soundsEnabled, setSoundsEnabled] = useState(false)
  const [leaseId, setLeaseId] = useState("")
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [queues, setQueues] = useState<string[]>([])
  const [relay, setRelay] = useState(false)
  const ice = useRef<IceConfiguration | null>(null)
  const [microphoneId, setMicrophoneId] = useState("default")
  const setup = useTeamQuery(
    api.calling.playgroundState.setup,
    {},
    { enabled: !!organizationId, optional: true }
  )
  const [now, setNow] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const phone = useRef<BrowserPhone | null>(null)
  const ring = useRef<RingSound | null>(null)
  const active = useRef<Id<"calls"> | null>(null)
  const seen = useRef<Id<"calls"> | null>(null)
  const started = useRef(0)
  const expectedLease = useRef("")
  const disconnect = useRef<{
    id: Id<"callAgents">
    browserId: string
    leaseId: string
  } | null>(null)
  const latest = useRef<Doc<"calls">[]>([])
  const alive = useRef(true)
  const operation = useRef(false)
  const stopRequested = useRef(false)
  const state = useTeamQuery(
    api.calling.softphoneState.state,
    {},
    { enabled: !!organizationId, optional: true }
  )
  const fetchIce = useAction(api.calling.softphone.iceServers)
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
  const ownsLease = ownsSoftphone(online, browserId, leaseId, state?.me)
  const incoming =
    ownsLease && !currentId
      ? state?.calls.find(
          (c) =>
            c.direction === "inbound" &&
            !c.test &&
            !c.assignedAgent &&
            ["queued", "ringing"].includes(c.status) &&
            offerIsFresh(c.offeredAt ?? c._creationTime, now)
        )
      : undefined
  const displayedId =
    incoming?._id ?? currentId ?? (card.id as Id<"calls"> | null)
  const caller = useTeamQuery(
    api.calling.playgroundState.detail,
    { id: displayedId! },
    { enabled: !!organizationId && !!displayedId, optional: true }
  )
  const waiting =
    state?.calls.filter(
      (c) =>
        !c.test &&
        c.direction === "inbound" &&
        !c.assignedAgent &&
        ["queued", "ringing"].includes(c.status) &&
        offerIsFresh(c.offeredAt ?? c._creationTime, now)
    ).length ?? 0
  const working =
    pending || ["registering", "claiming", "ending"].includes(phase)

  function reset(keepCard = false) {
    if (active.current && !keepCard)
      cardDispatch({ type: "ended", id: active.current })
    active.current = null
    testCallId.current = null
    seen.current = null
    setCurrentId(null)
    setMuted(false)
    dispatch("ended")
  }
  function fail(reason: unknown, fatal = false) {
    const message = actionError(reason)
    if (alive.current) {
      setError(message)
      toast.add({ type: "error", title: message })
      if (fatal) dispatch("fail")
    }
  }
  function finishOperation() {
    operation.current = false
    if (alive.current) setPending(false)
    if (stopRequested.current) {
      stopRequested.current = false
      void goAway().catch(() => undefined)
    }
  }
  async function goAway() {
    if (operation.current) return
    operation.current = true
    setPending(true)
    // Stop routing before waiting for any call teardown.
    setOnline(false)
    setRelay(false)
    ice.current = null
    ring.current?.stop()
    await presence({ ...args, status: "away" }).catch(() => undefined)
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
      await browser?.close()
      await revoke(args).catch(() => undefined)
      disconnect.current = null
      ring.current?.stop()
      if (alive.current) {
        setOnline(false)
        reset()
        dispatch("away")
      }
      finishOperation()
    }
  }
  async function goOnline(selectedMicrophone = microphoneId) {
    if (operation.current || !organizationId) return
    operation.current = true
    setPending(true)
    dispatch("online")
    setError("")
    let credential: Awaited<ReturnType<typeof session>> | undefined
    try {
      ring.current ??= new RingSound((enabled) => {
        if (alive.current) setSoundsEnabled(enabled)
      })
      setSoundsEnabled(await ring.current.arm().catch(() => false))
      credential = await session(args)
      if (!alive.current) {
        await revoke(args)
        return
      }
      expectedLease.current = credential.leaseId
      setLeaseId(credential.leaseId)
      disconnect.current = {
        id: credential.agentId,
        browserId,
        leaseId: credential.leaseId,
      }
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
                (c.status === "connected" || (c.test && c.status === "ringing"))
            )
            if (call) {
              active.current = call._id
              started.current = Date.now()
              dispatch("answer")
              setCurrentId(call._id)
              if (call.test) testCallId.current = call._id
              cardDispatch({ type: "connecting", id: call._id })
              return true
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          return false
        },
        connected: () => {
          if (alive.current) {
            dispatch("connected")
            if (active.current)
              cardDispatch({ type: "connected", id: active.current })
          }
        },
        ended: () => {
          if (alive.current) reset()
        },
        failed: (reason) => {
          fail(reason, true)
          if (operation.current) stopRequested.current = true
          else void goAway().catch(() => undefined)
        },
      }))
      browser.setMicrophone(selectedMicrophone)
      await browser.microphone()
      const configuration = await fetchIce(args)
      if (!alive.current) {
        await browser.close()
        await revoke(args)
        return
      }
      ice.current = configuration
      await browser.register(credential, configuration)
      setRelay(usesTurn(browserIceServers(configuration)))
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
      setRelay(false)
      ice.current = null
      if (credential) await revoke(args).catch(() => undefined)
      disconnect.current = null
      fail(reason, true)
    } finally {
      finishOperation()
    }
  }
  async function answer(id: Id<"calls">) {
    if (operation.current || !phone.current || !ownsLease) return
    operation.current = true
    setPending(true)
    dispatch("answer")
    ring.current?.stop()
    setError("")
    let claimed = false
    try {
      await claim({ ...args, id })
      claimed = true
      cardDispatch({ type: "connecting", id })
      await phone.current.microphone()
      active.current = id
      started.current = Date.now()
      setCurrentId(id)
      dispatch("claimed")
      await answerAction({ ...args, id })
    } catch (reason) {
      if (claimed) await release({ ...args, id }).catch(() => undefined)
      reset(true)
      cardDispatch({ type: "retry", id })
      dispatch("incoming")
      ring.current?.start()
      fail(reason)
    } finally {
      finishOperation()
    }
  }
  async function decline(id: Id<"calls">) {
    if (operation.current || !ownsLease) return
    operation.current = true
    setPending(true)
    ring.current?.stop()
    let claimed = false
    try {
      await claim({ ...args, id })
      claimed = true
      await hangupAction({ ...args, id })
      cardDispatch({ type: "declined", id })
      dispatch("ended")
    } catch (reason) {
      if (claimed) await release({ ...args, id }).catch(() => undefined)
      ring.current?.start()
      fail(reason)
    } finally {
      finishOperation()
    }
  }
  async function outbound(accountId: Id<"channelAccounts">, recipient: string) {
    if (!online || active.current || operation.current || !phone.current)
      throw new Error("Go online and finish your current call first")
    operation.current = true
    setPending(true)
    dispatch("answer")
    setError("")
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
      cardDispatch({ type: "connecting", id })
      dispatch("claimed")
    } catch (reason) {
      reset()
      fail(reason)
      throw reason
    } finally {
      finishOperation()
    }
  }
  async function hangup() {
    if (!active.current || operation.current) return
    operation.current = true
    setPending(true)
    dispatch("hangup")
    try {
      await (testCallId.current ? hangupTest : hangupAction)({
        ...args,
        id: active.current,
      })
      await phone.current?.hangup()
      reset()
    } catch (reason) {
      dispatch("hangupFailed")
      fail(reason)
    } finally {
      finishOperation()
    }
  }
  async function control(
    operationName: "hold" | "resume" | "transfer",
    target = ""
  ) {
    if (!active.current || operation.current) return
    operation.current = true
    setPending(true)
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
      finishOperation()
    }
  }
  useEffect(() => {
    latest.current = state?.calls ?? []
  }, [state])
  useEffect(() => {
    alive.current = true
    const leave = () => {
      if (disconnect.current) {
        const body = JSON.stringify(disconnect.current)
        if (!navigator.sendBeacon?.("/api/softphone/leave", body))
          void fetch("/api/softphone/leave", {
            method: "POST",
            body,
            keepalive: true,
          }).catch(() => undefined)
      }
      ring.current?.stop()
      void phone.current?.close()
    }
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        phone.current = null
        setOnline(false)
        reset()
        dispatch("away")
      }
    }
    window.addEventListener("pageshow", restore)
    window.addEventListener("pagehide", leave)
    const updateClock = () => setNow(Date.now())
    updateClock()
    const tick = setInterval(updateClock, 1000)
    return () => {
      alive.current = false
      window.removeEventListener("pageshow", restore)
      window.removeEventListener("pagehide", leave)
      leave()
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
    const renew = () => {
      if (renewing) return
      renewing = true
      void (async () => {
        const credential = await session({ organizationId, browserId })
        if (stopped) return
        if (credential.leaseId !== expectedLease.current)
          throw new Error("Agent session expired; go online again")
        if (ice.current && iceNeedsRefresh(ice.current)) {
          const configuration = await fetchIce({ organizationId, browserId })
          if (stopped) return
          ice.current = configuration
          phone.current?.setIceConfiguration(configuration)
          setRelay(usesTurn(browserIceServers(configuration)))
        }
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
    }
    const heartbeat = setInterval(renew, 30000)
    const resume = () => {
      if (document.visibilityState === "visible") renew()
    }
    document.addEventListener("visibilitychange", resume)
    return () => {
      stopped = true
      document.removeEventListener("visibilitychange", resume)
      clearInterval(heartbeat)
    }
    // Session callbacks use only this mounted team's stable args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, organizationId, browserId, session, presence, fetchIce])
  useEffect(() => {
    if (!incoming) {
      if (!active.current && !operation.current) {
        dispatch("ended")
        if (card.phase === "incoming" && card.id)
          cardDispatch({ type: "missed", id: card.id })
      }
      return
    }
    dispatch("incoming")
    cardDispatch({ type: "incoming", id: incoming._id })
    ring.current?.start()
    return () => {
      ring.current?.stop()
    }
  }, [incoming?._id, soundsEnabled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!["ended", "declined", "missed"].includes(card.phase)) return
    const timer = setTimeout(() => cardDispatch({ type: "dismiss" }), 5000)
    return () => clearTimeout(timer)
  }, [card.phase, card.id])
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
          presenceIsCurrent(a.availableUntil, now) &&
          a.userId !== current?.assignedAgent
      )
      .map((a) => ({ value: a.id!, label: a.name })),
    ...queues.map((q) => ({
      value: `queue:${q}`,
      label: `Queue: ${q.replace(/[-_]+/g, " ")}`,
    })),
  ]
  return (
    <Context.Provider
      value={{
        panelOpen: open,
        setPanelOpen: setOpen,
        panel: (
          <>
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor="softphone-online">Online</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  {online
                    ? "Ready to receive calls"
                    : "Away: new calls won’t ring here"}
                </p>
              </div>
              <Switch
                id="softphone-online"
                checked={online}
                disabled={working || phase === "connecting"}
                onCheckedChange={(next) => {
                  void (next ? goOnline() : goAway()).catch(fail)
                }}
              />
            </Field>
            <MicrophonePicker
              value={microphoneId}
              online={online}
              disabled={working || !!currentId}
              onChange={(value) => {
                setMicrophoneId(value)
                phone.current?.setMicrophone(value)
              }}
            />
            {online && relay && (
              <p className="text-xs text-muted-foreground">Relay: on</p>
            )}
            <p role="status" className="text-sm">
              Calls waiting: {waiting}
            </p>
            {state?.me &&
              state.me.browserId !== browserId &&
              state.me.status === "online" && (
                <p className="text-xs text-muted-foreground">
                  Your softphone is online in another tab. Set it Away there to
                  use this tab.
                </p>
              )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Link
              href="/playground/calls"
              className={buttonVariants({ variant: "outline", size: "sm" })}
              onClick={() => setOpen(false)}
            >
              Playground › Calls
            </Link>
          </>
        ),
        online,
        busy: !!currentId || working || phase === "connecting",
        available: !!organizationId && hasAgentRoute(setup?.numbers),
        connecting: phase === "connecting",
        working,
        callLabel: incoming
          ? "Incoming call"
          : currentId
            ? "Current call"
            : "Softphone",
        open: () => {
          if (incoming || currentId) cardDispatch({ type: "expand" })
          else setOpen(true)
        },
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
        testCall: async (
          accountId,
          target,
          contactId,
          microphoneId = "default"
        ) => {
          if (active.current || operation.current)
            throw new Error("Finish your current call first")
          if (!online) await goOnline(microphoneId)
          if (!phone.current) throw new Error("Calling could not connect")
          operation.current = true
          setPending(true)
          try {
            phone.current.setMicrophone(microphoneId)
            await phone.current.microphone()
            return await startTest({ ...args, accountId, ...target, contactId })
          } finally {
            finishOperation()
          }
        },
        outbound,
      }}
    >
      <audio ref={audio} autoPlay aria-label="Call audio" />
      {children}
      <FloatingCallCard
        key={card.id ?? "none"}
        state={card}
        dispatch={cardDispatch}
        name={caller?.contact_name ?? "WhatsApp caller"}
        number={caller?.contact_phone}
        timer={callTimer(callElapsed(current?.connectedAt, now))}
        muted={muted}
        working={working}
        soundsEnabled={soundsEnabled}
        enableSounds={() => {
          void (async () => {
            ring.current ??= new RingSound((enabled) => {
              if (alive.current) setSoundsEnabled(enabled)
            })
            setSoundsEnabled(await ring.current.arm().catch(() => false))
            if (incoming) ring.current.start()
          })()
        }}
        accept={() => {
          if (incoming) void answer(incoming._id)
        }}
        decline={() => {
          if (incoming) void decline(incoming._id)
        }}
        mute={() => {
          phone.current?.mute(!muted)
          setMuted(!muted)
        }}
        dtmf={(digit) => {
          void phone.current?.dtmf(digit).catch(fail)
        }}
        transfer={(target) => {
          void control("transfer", target)
        }}
        hangup={() => {
          void hangup()
        }}
        transferItems={transferItems}
        error={error}
      />
    </Context.Provider>
  )
}
