"use client"

import { useRef, useState } from "react"
import {
  ArrowRightLeftIcon,
  Grid3X3Icon,
  MicIcon,
  MicOffIcon,
  MinusIcon,
  PhoneIcon,
  PhoneOffIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { OptionSelect } from "@/components/dashboard/primitives"
import { DtmfKeypad } from "./dtmf-keypad"
import type { CallCardState, CallCardEvent } from "@/lib/meta/call-card"

export function FloatingCallCard({
  state,
  dispatch,
  name,
  number,
  timer,
  muted,
  working,
  soundsEnabled,
  enableSounds,
  accept,
  decline,
  mute,
  dtmf,
  transfer,
  hangup,
  transferItems,
  error,
}: {
  state: CallCardState
  dispatch: (event: CallCardEvent) => void
  name: string
  number?: string | null
  timer: string
  muted: boolean
  working: boolean
  soundsEnabled: boolean
  enableSounds: () => void
  accept: () => void
  decline: () => void
  mute: () => void
  dtmf: (digit: string) => void
  transfer: (target: string) => void
  hangup: () => void
  transferItems: { value: string; label: string }[]
  error: string
}) {
  const [keypad, setKeypad] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [target, setTarget] = useState("")
  const restoreFocus = useRef(false)
  const terminal = ["ended", "declined", "missed"].includes(state.phase)
  const incoming = state.phase === "incoming"
  const active = state.phase === "active"
  const status = incoming
    ? "Incoming call"
    : active
      ? "In call"
      : state.phase === "connecting"
        ? "Connecting…"
        : state.phase === "declined"
          ? "Call declined"
          : state.phase === "missed"
            ? "Missed call"
            : "Call ended"
  if (state.phase === "hidden") return null
  const focus = (element: HTMLButtonElement | null) => {
    if (element && restoreFocus.current) {
      element.focus()
      restoreFocus.current = false
    }
  }
  return (
    <div className="fixed right-4 bottom-4 z-40 max-w-[calc(100vw-2rem)] pb-[env(safe-area-inset-bottom)]">
      {state.minimized ? (
        <Button
          ref={focus}
          variant="outline"
          className="max-w-full rounded-full bg-popover px-4 shadow-float"
          aria-label={`Expand call with ${name}`}
          onClick={() => {
            restoreFocus.current = true
            dispatch({ type: "expand" })
          }}
        >
          <PhoneIcon className={incoming ? "motion-safe:animate-pulse" : ""} />
          <span className="truncate">{name}</span>
          <span className="text-muted-foreground">
            {active ? timer : status}
          </span>
        </Button>
      ) : (
        <Card
          size="sm"
          role="region"
          aria-label="Call card"
          className="max-h-[calc(100dvh-2rem)] w-80 overflow-y-auto border border-border bg-card shadow-float"
        >
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PhoneIcon
                    className={`size-3.5 shrink-0 ${incoming ? "motion-safe:animate-pulse" : ""}`}
                  />
                  WhatsApp call
                </p>
                <p className="mt-1 truncate text-base font-medium">{name}</p>
                {number && number !== name && (
                  <p className="truncate text-sm text-muted-foreground">
                    {number}
                  </p>
                )}
              </div>
              <Button
                ref={focus}
                size="icon-sm"
                variant="ghost"
                aria-label={terminal ? "Dismiss call" : "Minimize call"}
                onClick={() => {
                  restoreFocus.current = !terminal
                  dispatch({ type: terminal ? "dismiss" : "minimize" })
                }}
              >
                {terminal ? <XIcon /> : <MinusIcon />}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p role="status" className="text-sm font-medium">
                {status}
              </p>
              {active && (
                <span
                  aria-label="Call duration"
                  className="text-sm text-muted-foreground tabular-nums"
                >
                  {timer}
                </span>
              )}
            </div>
            {incoming && (
              <>
                {!soundsEnabled && (
                  <Button variant="outline" size="sm" onClick={enableSounds}>
                    Enable call sounds
                  </Button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button disabled={working} onClick={accept}>
                    <PhoneIcon />
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    disabled={working}
                    onClick={decline}
                  >
                    <PhoneOffIcon />
                    Decline
                  </Button>
                </div>
              </>
            )}
            {!incoming && !terminal && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!active || working}
                    aria-pressed={muted}
                    onClick={mute}
                  >
                    {muted ? <MicOffIcon /> : <MicIcon />}
                    {muted ? "Unmute" : "Mute"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!active || working}
                    aria-expanded={keypad}
                    onClick={() => {
                      setKeypad(!keypad)
                      setTransferring(false)
                    }}
                  >
                    <Grid3X3Icon />
                    Keypad
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!active || working}
                    aria-expanded={transferring}
                    onClick={() => {
                      setTransferring(!transferring)
                      setKeypad(false)
                    }}
                  >
                    <ArrowRightLeftIcon />
                    Transfer
                  </Button>
                </div>
                {keypad && (
                  <DtmfKeypad
                    disabled={!active || working}
                    send={dtmf}
                    label="Call keypad"
                  />
                )}
                {transferring && (
                  <div className="flex flex-col gap-2">
                    <OptionSelect
                      aria-label="Transfer destination"
                      placeholder="Choose an agent or queue"
                      value={target}
                      onChange={setTarget}
                      items={transferItems}
                    />
                    {!transferItems.length && (
                      <p className="text-xs text-muted-foreground">
                        No other agents are available.
                      </p>
                    )}
                    <Button
                      variant="outline"
                      disabled={
                        !target ||
                        working ||
                        !transferItems.some((item) => item.value === target)
                      }
                      onClick={() => transfer(target)}
                    >
                      Transfer call
                    </Button>
                  </div>
                )}
                <Button
                  variant="destructive"
                  disabled={working}
                  onClick={hangup}
                >
                  <PhoneOffIcon />
                  Hang up
                </Button>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
