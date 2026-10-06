"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAction, useQuery } from "convex/react"
import { useWorkspace, useTeamRole } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { FieldDescription } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { PhoneOutgoingIcon } from "lucide-react"
import { useClock } from "@/lib/time/use-clock"
import { actionError } from "@/lib/action-error"
import { callPermissionLabel } from "@/lib/dashboard/voice-playground"
import { PlaceCallFields, type PlaceCallConfig } from "./place-call-fields"

export function CallWithBot({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false)
  const { canWrite } = useTeamRole()
  return (
    <>
      <Button
        variant="outline"
        disabled={!canWrite}
        onClick={() => setOpen(true)}
      >
        <PhoneOutgoingIcon />
        Call with bot
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Call with bot</DialogTitle>
            <DialogDescription>
              Choose the WhatsApp number and bot or IVR to call this contact.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <CallForm contactId={contactId} onPlaced={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
function CallForm({
  contactId,
  onPlaced,
}: {
  contactId: string
  onPlaced: () => void
}) {
  const { activeTeamId } = useWorkspace()
  const router = useRouter()
  const [config, setConfig] = useState<PlaceCallConfig>({
    accountId: "",
    route: "",
    purpose: "",
    variables: {},
    requestPermission: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const clock = useClock()
  const [refreshedAt, setRefreshedAt] = useState(0)
  const now = clock ? Math.max(clock, refreshedAt) : null
  const cached = useQuery(
    api.calling.outboundState.cachedPermission,
    activeTeamId && config.accountId && now
      ? { organizationId: activeTeamId, from: config.accountId, contactId, now }
      : "skip"
  )
  const refresh = useAction(api.calling.outbound.dashboardPermission)
  const place = useAction(api.calling.outbound.dashboardPlace)
  const permission = cached as
    { status: string; expires_at: number | null } | undefined
  const input = {
    contact_id: contactId,
    from: config.accountId,
    route: config.route,
    context: config.purpose,
    variables: config.variables,
    request_permission: config.requestPermission,
  }
  async function perform(check = false) {
    if (!activeTeamId) return
    setBusy(true)
    setError("")
    try {
      if (check) {
        await refresh({ organizationId: activeTeamId, input })
        setRefreshedAt(Date.now())
        return
      }
      const result = await place({ organizationId: activeTeamId, input })
      if (result.status === "ringing" || result.status === "queued") {
        toast.add({ type: "success", title: "Call placed" })
        onPlaced()
        router.push(`/playground/calls/${result.id}`)
      } else if (result.status === "permission_requested") {
        toast.add({
          type: "success",
          title: "Calling permission requested",
          description: "Place the call after the contact approves.",
        })
        setRefreshedAt(Date.now())
      } else
        setError(
          result.status === "calling_limited"
            ? "Meta's calling limit has been reached. Try again after the limit resets."
            : "Calling permission is required. Request permission and place the call after the contact approves."
        )
    } catch (reason) {
      setError(actionError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void perform()
      }}
    >
      <PlaceCallFields config={config} onChange={setConfig} disabled={busy} />
      {config.accountId ? (
        <div className="flex items-center justify-between gap-2">
          <FieldDescription>
            Calling permission: {callPermissionLabel(permission?.status)}
            {permission?.expires_at
              ? ` · expires ${new Date(permission.expires_at).toLocaleString()}`
              : ""}
          </FieldDescription>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void perform(true)}
          >
            Refresh
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={busy || !config.accountId || !config.route}
      >
        {busy ? "Please wait…" : "Place call"}
      </Button>
    </form>
  )
}

export function CallPermissionStatus({
  contactId,
  accountId,
}: {
  contactId: string
  accountId: string
}) {
  const { activeTeamId } = useWorkspace()
  const now = useClock()
  const permission = useQuery(
    api.calling.outboundState.cachedPermission,
    activeTeamId && now
      ? { organizationId: activeTeamId, from: accountId, contactId, now }
      : "skip"
  )
  return (
    <span className="text-xs text-muted-foreground">
      Calling permission: {callPermissionLabel(permission?.status)}
      {permission?.expires_at
        ? ` · expires ${new Date(permission.expires_at).toLocaleString()}`
        : ""}
    </span>
  )
}
