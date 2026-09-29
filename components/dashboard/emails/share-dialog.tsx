"use client"

import * as React from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useWorkspace, useTeamRole } from "@/components/auth/workspace"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { CopyButton, OptionSelect } from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { formatDateTime } from "@/lib/dashboard/format"

/* Resend's choices; links last at most 48 hours. */
const EXPIRY_ITEMS = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "48h", label: "48 hours" },
]

export function useShareEmail(id: string) {
  const { activeTeamId } = useWorkspace()
  const { canWrite } = useTeamRole()
  const create = useMutation(api.emailShares.create)
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
  const [expiresIn, setExpiresIn] = React.useState("48h")
  const [savedShare, setShare] = React.useState<{
    id: string
    organizationId: string
    url: string
    expiresAt: number
  } | null>(null)

  const share =
    savedShare?.id === id && savedShare.organizationId === activeTeamId
      ? savedShare
      : null

  async function generate() {
    if (pending || !canWrite || !activeTeamId) return
    setPending(true)
    setError("")
    try {
      setShare({
        ...(await create({
          organizationId: activeTeamId,
          id: id as Id<"emails"> | Id<"receivedEmails">,
          expiresIn,
        })),
        organizationId: activeTeamId,
      })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
  }

  return {
    canWrite,
    open: () => {
      setShare(null)
      setError("")
      setExpiresIn("48h")
      setOpen(true)
    },
    dialog: (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-md"
          onKeyDown={(event) => {
            if (!share && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void generate()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Share email</DialogTitle>
            <DialogDescription>
              Anyone with the link can view this email.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4" aria-busy={pending}>
            {share ? (
              <>
                <Field>
                  <FieldLabel htmlFor="email-share-link">Share link</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="email-share-link"
                      value={share.url}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                    <CopyButton value={share.url} label="share link" />
                  </div>
                </Field>
                <p className="text-sm text-muted-foreground">
                  Expires {formatDateTime(share.expiresAt)}
                </p>
              </>
            ) : (
              <Field>
                <FieldLabel htmlFor="email-share-expiry">
                  Link expires after
                </FieldLabel>
                <OptionSelect
                  id="email-share-expiry"
                  className="w-full"
                  value={expiresIn}
                  onChange={setExpiresIn}
                  items={EXPIRY_ITEMS}
                  disabled={pending}
                />
              </Field>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            {share ? (
              <DialogClose render={<Button />}>Done</DialogClose>
            ) : (
              <>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                  <Kbd>Esc</Kbd>
                </DialogClose>
                <Button
                  disabled={pending || !canWrite}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                  onClick={() => void generate()}
                >
                  {pending ? "Generating…" : "Generate link"}
                  <Kbd>⌘↵</Kbd>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
