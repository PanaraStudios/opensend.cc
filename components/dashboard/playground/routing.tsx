"use client"
import type { Id } from "@/convex/_generated/dataModel"
import { useState } from "react"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  DetailSection,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
export function VoiceRouting({
  kind,
  id,
}: {
  kind: "ivr" | "bot"
  id: string
}) {
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  const { activeTeamId } = useWorkspace()
  const update = useAction(api.calling.settings.dashboardUpdate)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  return (
    <DetailSection title="Routing">
      <p className="text-sm text-muted-foreground">
        Assigning a number replaces its current IVR, voice bot or agents route.
        Removing an assignment restores agents routing. Gateway configuration is
        required.
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
          Connect a WhatsApp number in Channels to assign routing.
        </p>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Number</Th>
              <Th>Current route</Th>
              <Th />
            </>
          }
        >
          {setup.numbers.map((n) => {
            const assigned = n.routing === `${kind}:${id}`
            return (
              <TableRow key={n.id}>
                <TableCell>{n.label}</TableCell>
                <TableCell>{n.routing ?? "Default"}</TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    disabled={!!busy || !setup.routingConfigured}
                    onClick={async () => {
                      setBusy(n.id)
                      setError("")
                      try {
                        await update({
                          organizationId: activeTeamId!,
                          from: n.id,
                          routing: assigned
                            ? { kind: "agents" }
                            : kind === "ivr"
                              ? { kind: "ivr", ivrId: id as Id<"ivrs"> }
                              : { kind: "bot", botId: id as Id<"voiceBots"> },
                        })
                      } catch (e) {
                        setError(actionError(e))
                      } finally {
                        setBusy("")
                      }
                    }}
                  >
                    {busy === n.id
                      ? "Saving…"
                      : assigned
                        ? "Unassign"
                        : "Assign"}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </ResourceTable>
      )}
    </DetailSection>
  )
}
