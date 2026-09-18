"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CircleAlertIcon,
  CircleCheckIcon,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { toast } from "@/components/ui/toast"
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"
import { useEmailHtml } from "@/components/dashboard/broadcasts/editor/use-editor"
import { audienceLabel } from "@/lib/dashboard/broadcast"
import {
  hasUnsubscribeLink,
  isDocumentEmpty,
  type EmailDocument,
} from "@/lib/dashboard/email-document"
import {
  formatDateTime,
  isEmail,
  workspaceFromAddress,
} from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"

type CheckLevel = "ok" | "warn" | "error"

type Check = { level: CheckLevel; label: string; detail: string }

const CHECK_ICON = {
  ok: CircleCheckIcon,
  warn: TriangleAlertIcon,
  error: CircleAlertIcon,
}

const CHECK_CLASS = {
  ok: "text-success",
  warn: "text-warning",
  error: "text-destructive",
}

/** Everything that has to be true before a broadcast can go out, plus the
    softer warnings that only need a nudge. */
export function reviewChecks(
  item: Broadcast,
  doc: EmailDocument,
  from: string,
  audience: string,
  verified: boolean
): Check[] {
  const empty = isDocumentEmpty(doc)
  const unsubscribe = hasUnsubscribeLink(doc)
  return [
    {
      level: verified ? "ok" : "warn",
      label: "From address",
      detail: verified ? from : `${from} — no verified domain yet`,
    },
    {
      level: "ok",
      label: "Audience",
      detail: audience,
    },
    {
      level: item.subject.trim() ? "ok" : "error",
      label: "Subject",
      detail: item.subject.trim() || "Add a subject before sending",
    },
    {
      level: empty ? "error" : "ok",
      label: "Content",
      detail: empty ? "The email is still empty" : "The email has content",
    },
    {
      level: unsubscribe ? "ok" : "warn",
      label: "Unsubscribe link",
      detail: unsubscribe
        ? "An opt-out link is present"
        : "Add an unsubscribe footer so recipients can opt out",
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
              from: workspaceFromAddress(state.domains),
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

export function ReviewSheet({
  open,
  onOpenChange,
  item,
  doc,
  sendAt,
  flush,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: Broadcast
  doc: EmailDocument
  sendAt: number | null
  /** Saves the newest edit, so the send copies the email on screen. */
  flush: () => Promise<void>
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-md"
        data-testid="review-sheet"
      >
        <ReviewSheetBody
          onClose={() => onOpenChange(false)}
          item={item}
          doc={doc}
          sendAt={sendAt}
          flush={flush}
        />
      </SheetContent>
    </Sheet>
  )
}

/* Mounted only while the sheet is open, so a closed sheet does not render the
   email on every edit. */
function ReviewSheetBody({
  onClose,
  item,
  doc,
  sendAt,
  flush,
}: {
  onClose: () => void
  item: Broadcast
  doc: EmailDocument
  sendAt: number | null
  flush: () => Promise<void>
}) {
  const router = useRouter()
  const { state, setBroadcastStatus } = useDashboard()
  const html = useEmailHtml(doc, item.preview)
  const verified = state.domains.some((domain) => domain.status === "verified")
  const from = workspaceFromAddress(state.domains)
  const audience = audienceLabel(item.segmentId, state.segments)
  const checks = reviewChecks(item, doc, from, audience, verified)
  const blocked = checks.some((check) => check.level === "error")

  function finish(title: string) {
    toast.add({ type: "success", title })
    onClose()
    router.push(`/broadcasts/${item.id}`)
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Review</SheetTitle>
        <SheetDescription>
          Check the send, then schedule it or send it now.
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <ul className="flex flex-col gap-2.5">
          {checks.map((check) => {
            const Icon = CHECK_ICON[check.level]
            return (
              <li
                key={check.label}
                className="flex items-start gap-2.5"
                data-testid={`review-check-${check.level}`}
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${CHECK_CLASS[check.level]}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {check.label}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {check.detail}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
        <div className="h-64 overflow-hidden rounded-xl border border-border">
          <EmailPreviewFrame
            title="Broadcast preview"
            data-testid="review-preview"
            html={html}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border p-4">
        <p className="text-caption text-muted-foreground">
          {sendAt ? `Scheduled for ${formatDateTime(sendAt)}` : "Sends now"}
        </p>
        <div className="flex items-center gap-2">
          {sendAt ? (
            <Button
              variant="outline"
              disabled={blocked}
              data-testid="review-schedule"
              onClick={() => {
                void flush().then(() => {
                  setBroadcastStatus(item.id, "scheduled", sendAt)
                  finish("Broadcast scheduled")
                })
              }}
            >
              Schedule
            </Button>
          ) : null}
          <Button
            disabled={blocked}
            data-testid="review-send"
            onClick={() => {
              void flush().then(() => {
                setBroadcastStatus(item.id, "sent")
                finish("Broadcast sent")
              })
            }}
          >
            <SendIcon data-icon="inline-start" />
            Send now
          </Button>
        </div>
      </div>
    </>
  )
}
