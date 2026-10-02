"use client"
import type { Id } from "@/convex/_generated/dataModel"
import { useState } from "react"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { ConfirmDialog } from "@/components/dashboard/primitives"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
export function VoiceRouting({
  kind,
  id,
}: {
  kind: "ivr" | "bot"
  id: string
}) {
  const setup = useTeamQuery(api.calling.playgroundState.setup),
    { activeTeamId } = useWorkspace(),
    update = useAction(api.calling.settings.dashboardUpdate)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [replace, setReplace] = useState<{ id: string; label: string } | null>(null)
  async function assign(numberId: string, checked: boolean) {
    setBusy(true)
    setError("")
    try {
      await update({
        organizationId: activeTeamId!,
        from: numberId,
        routing: !checked
          ? { kind: "agents" }
          : kind === "ivr"
            ? { kind: "ivr", ivrId: id as Id<"ivrs"> }
            : { kind: "bot", botId: id as Id<"voiceBots"> },
      })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Choose the WhatsApp numbers that route here.
      </p>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {!setup ? (
        <Skeleton className="h-20 w-full" />
      ) : !setup.numbers.length ? (
        <p className="text-sm text-muted-foreground">
          Connect a WhatsApp number in Channels.
        </p>
      ) : (
        setup.numbers.map((n) => (
          <Field orientation="horizontal" key={n.id}>
            <Checkbox
              aria-label={`Route ${n.label}`}
              checked={n.routing === `${kind}:${id}`}
              disabled={busy || !setup.routingConfigured}
              onCheckedChange={(checked) => {
                if (checked && n.routing && n.routing !== `${kind}:${id}`)
                  setReplace(n)
                else void assign(n.id, checked)
              }}
            />
            <FieldLabel>{n.label}</FieldLabel>
          </Field>
        ))
      )}
      <ConfirmDialog
        open={!!replace}
        onOpenChange={(v) => {
          if (!v) setReplace(null)
        }}
        title="Replace phone routing?"
        description={`${replace?.label ?? "This number"} will route here. Its current agents, IVR or voice bot route will be replaced.`}
        confirmLabel="Replace routing"
        onConfirm={() => assign(replace!.id, true)}
      />
    </div>
  )
}
