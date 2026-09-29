"use client"

import * as React from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useWorkspace, useTeamRole } from "@/components/auth/workspace"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
import { CopyButton } from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { formatDateTime } from "@/lib/dashboard/format"

export function useShareEmail(id: string) {
  const { activeTeamId } = useWorkspace()
  const { canWrite } = useTeamRole()
  const create = useMutation(api.emailShares.create)
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
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
      setOpen(true)
      if (!share || share.expiresAt <= Date.now()) void generate()
    },
    dialog: (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share email</DialogTitle>
            <DialogDescription>
              Anyone with this link can view this email for 48 hours without
              signing in.
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
            ) : pending ? (
              <Skeleton className="h-9 w-full" />
            ) : null}
            {pending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Creating link…
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Done
            </DialogClose>
            <Button
              disabled={pending || !canWrite}
              onClick={() => void generate()}
            >
              {share ? "Create new link" : "Create link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
