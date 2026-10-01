"use client"
import { useState } from "react"
import { useAction } from "convex/react"
import { useWorkspace } from "@/components/auth/workspace"
import type { Id } from "@/convex/_generated/dataModel"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { PhoneIcon } from "lucide-react"
import { useSoftphone } from "./softphone-provider"
/** Reusable by contact details and the conversation header when it is integrated. */
export function CallButton({
  accountId,
  recipient,
  label = "Call",
}: {
  accountId: Id<"channelAccounts">
  recipient: string
  label?: string
}) {
  const { activeTeamId } = useWorkspace()
  const softphone = useSoftphone()
  const permission = useAction(api.calling.softphone.permission)
  const request = useAction(api.calling.softphone.requestPermission)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    canCall: boolean
    canRequest: boolean
  } | null>(null)
  const [error, setError] = useState("")
  const args = { organizationId: activeTeamId ?? "", accountId, recipient }
  async function check() {
    setOpen(true)
    setBusy(true)
    setError("")
    setResult(null)
    try {
      setResult(await permission(args))
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Permission check failed"
      )
    } finally {
      setBusy(false)
    }
  }
  async function perform() {
    if (!result) return
    setBusy(true)
    setError("")
    try {
      if (result.canCall) await softphone.outbound(accountId, recipient)
      else {
        await request(args)
        toast.add({ type: "success", title: "Calling permission requested" })
      }
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Call request failed")
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || softphone.busy}
        onClick={() => {
          void check()
        }}
      >
        <PhoneIcon />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WhatsApp voice call</DialogTitle>
            <DialogDescription>
              {busy
                ? "Checking calling permission…"
                : result?.canCall
                  ? "This contact has granted calling permission."
                  : "The contact needs to grant permission before you can call."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {result?.canCall && !softphone.online ? (
            <p className="text-muted-foreground">
              Go online with the softphone before placing your call.
            </p>
          ) : null}
          {result && !result.canCall && !result.canRequest ? (
            <p className="text-muted-foreground">
              Meta does not allow another permission request yet. Check the
              channel call permissions for limits, or use an approved permission
              template outside the messaging window.
            </p>
          ) : null}
          {result ? (
            <Button
              disabled={
                busy ||
                (result.canCall
                  ? !softphone.online || softphone.busy
                  : !result.canRequest)
              }
              onClick={() => {
                void perform()
              }}
            >
              {result.canCall ? "Call" : "Request permission"}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void check()
              }}
            >
              Check permission
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
