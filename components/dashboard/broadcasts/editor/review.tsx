"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CircleCheckIcon,
  CircleXIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { toast } from "@/components/ui/toast"
import {
  audienceLabel,
  broadcastFrom,
  broadcastRecipients,
} from "@/lib/dashboard/broadcast"
import { hasUnsubscribeLink } from "@/lib/dashboard/email-variables"
import { isEmail, pluralize } from "@/lib/dashboard/format"
import { formatScheduleHint } from "@/lib/dashboard/schedule"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

type CheckLevel = "ok" | "warn" | "error"

type Check = { id: string; level: CheckLevel; label: string }

const CHECK_ICON = {
  ok: CircleCheckIcon,
  warn: TriangleAlertIcon,
  error: CircleXIcon,
}

const CHECK_CLASS = {
  ok: "text-success",
  warn: "text-warning",
  error: "text-destructive",
}

/** Everything that has to be true before a broadcast can go out, plus the
    softer warnings that only need a nudge. One line each. */
export function reviewChecks({
  item,
  html,
  empty,
  from,
  verified,
  audience,
  recipients,
  sendAt,
}: {
  item: Broadcast
  /** The email as it would be sent. */
  html: string
  empty: boolean
  from: string
  verified: boolean
  audience: string
  recipients: number
  sendAt: number | null
}): Check[] {
  const subject = item.subject.trim()
  const unsubscribe = hasUnsubscribeLink(html)
  return [
    {
      id: "when",
      level: "ok",
      label: sendAt
        ? `Sending at ${formatScheduleHint(sendAt)}`
        : "Sending right away",
    },
    {
      id: "from",
      level: verified ? "ok" : "warn",
      label: verified
        ? `Sending from ${from}`
        : "No verified domain, sending from the shared address",
    },
    { id: "audience", level: "ok", label: `Sending to ${audience}` },
    {
      id: "subject",
      level: subject ? "ok" : "error",
      label: subject ? "Subject line added" : "Add a subject line to continue",
    },
    {
      id: "content",
      level: empty ? "error" : "ok",
      label: empty ? "Add content to continue" : "Content added",
    },
    {
      id: "recipients",
      level: recipients === 0 ? "error" : "ok",
      label:
        recipients === 0
          ? "No contacts in this segment"
          : `${pluralize(recipients, "contact")} will get this email`,
    },
    {
      id: "unsubscribe",
      level: unsubscribe ? "ok" : "warn",
      label: unsubscribe
        ? "Unsubscribe link detected"
        : "No unsubscribe link detected",
    },
  ]
}

export function TestEmailDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: Broadcast
}) {
  const { state, sendEmail } = useDashboard()
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const you = state.members.find((member) => member.you)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const to = value.trim() || you?.email || ""
            if (!isEmail(to)) {
              setError("Enter a valid email address")
              return
            }
            sendEmail({
              from: broadcastFrom(item, state.domains),
              to,
              subject: `[Test] ${item.subject || item.name || "Untitled"}`,
              text: item.preview || "Test send from the broadcast editor.",
              html: item.html,
            })
            toast.add({ type: "success", title: `Test email sent to ${to}` })
            onOpenChange(false)
            setValue("")
          }}
        >
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>
              We send the current draft to one address. It does not touch your
              audience.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Field>
              <FieldLabel htmlFor="brd-test-email">Send to</FieldLabel>
              <Input
                id="brd-test-email"
                type="email"
                autoFocus
                placeholder={you?.email ?? "you@example.com"}
                data-testid="test-email-input"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" data-testid="test-email-send">
              Send test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* A send cannot be taken back, so it asks for a drag rather than a click.
   Enter on the handle does the same for keyboard users. */
function SlideToConfirm({
  label,
  disabled,
  onConfirm,
  testId,
}: {
  label: string
  disabled: boolean
  onConfirm: () => void
  testId: string
}) {
  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ origin: number; max: number } | null>(null)
  const [offset, setOffset] = React.useState(0)

  return (
    <div
      ref={track}
      className={cn(
        "relative h-10 rounded-full border border-border bg-muted/40 select-none",
        disabled && "opacity-50"
      )}
    >
      <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
        style={{ transform: `translateX(${offset}px)` }}
        className={cn(
          "absolute top-1 left-1 flex h-8 w-14 touch-none items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
          offset === 0 && "transition-transform"
        )}
        onPointerDown={(event) => {
          const width = track.current?.clientWidth ?? 0
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            origin: event.clientX,
            max: width - event.currentTarget.offsetWidth - 8,
          }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const moved = event.clientX - drag.current.origin
          setOffset(Math.min(Math.max(moved, 0), drag.current.max))
        }}
        onPointerUp={() => {
          const current = drag.current
          drag.current = null
          if (current && offset >= current.max - 4) onConfirm()
          else setOffset(0)
        }}
        onPointerCancel={() => {
          drag.current = null
          setOffset(0)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") onConfirm()
        }}
      >
        <SendIcon className="size-4" />
      </button>
    </div>
  )
}

export function ReviewPopover({
  item,
  html,
  empty,
  sendAt,
  flush,
}: {
  item: Broadcast
  html: string
  empty: boolean
  sendAt: number | null
  /** Saves the newest edit, so the send copies the email on screen. */
  flush: () => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        /* The checks read the exported email, so it is brought up to date. */
        if (next) void flush()
        setOpen(next)
      }}
    >
      <PopoverTrigger render={<Button size="sm" data-testid="editor-review" />}>
        Review
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-96 gap-0 p-0"
        data-testid="review-popover"
      >
        <ReviewBody
          onClose={() => setOpen(false)}
          item={item}
          html={html}
          empty={empty}
          sendAt={sendAt}
          flush={flush}
        />
      </PopoverContent>
    </Popover>
  )
}

/* Mounted only while the popover is open, so a closed one does not recount
   the audience on every edit. */
function ReviewBody({
  onClose,
  item,
  html,
  empty,
  sendAt,
  flush,
}: {
  onClose: () => void
  item: Broadcast
  html: string
  empty: boolean
  sendAt: number | null
  flush: () => Promise<void>
}) {
  const router = useRouter()
  const { state, setBroadcastStatus } = useDashboard()
  const checks = reviewChecks({
    item,
    html,
    empty,
    sendAt,
    from: broadcastFrom(item, state.domains),
    verified: state.domains.some((domain) => domain.status === "verified"),
    audience: audienceLabel(item.segmentId, state.segments),
    recipients: broadcastRecipients(state.contacts, item).length,
  })
  const blocked = checks.some((check) => check.level === "error")

  return (
    <>
      <h2 className="px-4 pt-4 pb-1 text-sm font-medium">Ready to send?</h2>
      <ul className="flex flex-col px-4">
        {checks.map((check) => {
          const Icon = CHECK_ICON[check.level]
          return (
            <li
              key={check.id}
              className="flex items-center gap-2.5 border-b border-border py-2.5 text-sm last:border-b-0"
              data-testid={`review-check-${check.id}`}
              data-level={check.level}
            >
              <Icon
                className={cn("size-4 shrink-0", CHECK_CLASS[check.level])}
              />
              <span className="min-w-0 truncate">{check.label}</span>
            </li>
          )
        })}
      </ul>
      <div className="p-4 pt-2">
        <SlideToConfirm
          label={sendAt ? "Slide to schedule" : "Slide to send"}
          disabled={blocked}
          testId="review-send"
          onConfirm={() => {
            void flush().then(() => {
              if (sendAt) setBroadcastStatus(item.id, "scheduled", sendAt)
              else setBroadcastStatus(item.id, "sent")
              toast.add({
                type: "success",
                title: sendAt ? "Broadcast scheduled" : "Broadcast sent",
              })
              onClose()
              router.push(`/broadcasts/${item.id}`)
            })
          }}
        />
      </div>
    </>
  )
}
