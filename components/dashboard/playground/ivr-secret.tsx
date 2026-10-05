"use client"

import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useAction } from "convex/react"

import { useWorkspace } from "@/components/auth/workspace"
import { ViewApiKeyDialog } from "@/components/dashboard/api-keys/shared"
import { ConfirmDialog } from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import { revealedIvrSigningSecretFromResult } from "@/lib/dashboard/ivr-secret"

const IvrRecordContext = createContext<{
  id: string
  reveal: (secret: string) => void
} | null>(null)

export function IvrRecordProvider({
  id,
  reveal,
  children,
}: {
  id: string
  reveal: (secret: string) => void
  children: ReactNode
}) {
  const value = useMemo(() => ({ id, reveal }), [id, reveal])
  return (
    <IvrRecordContext.Provider value={value}>
      {children}
    </IvrRecordContext.Provider>
  )
}

/** Same one-time field API keys use after they are created. */
export function IvrSigningSecretDialog({
  secret,
  onOpenChange,
}: {
  secret: string | null
  onOpenChange: (open: boolean) => void
}) {
  const fieldId = useId()
  return (
    <ViewApiKeyDialog
      token={secret}
      onOpenChange={onOpenChange}
      title="Signing secret"
      description="Copy it into the service that verifies IVR webhook signatures."
      fieldLabel="Signing secret"
      secretLabel="Signing secret"
      fieldId={fieldId}
      alertTitle="You won't see it again."
      alertDescription="Store it before you close this dialog."
    />
  )
}

/** Reads stay hidden. Rotation is the only way to see a new secret. */
export function IvrSigningSecret() {
  const record = useContext(IvrRecordContext)
  const { activeTeamId } = useWorkspace()
  const rotate = useAction(api.ivr.definitions.dashboardRotateSecret)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm break-words">Signing secret: hidden</p>
      <p className="text-sm break-words text-muted-foreground">
        Webhook decisions are signed with this secret.
      </p>
      {record ? (
        <Button
          type="button"
          variant="outline"
          className="w-fit max-w-full"
          onClick={() => setConfirming(true)}
        >
          Rotate secret
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Rotate signing secret?"
        description="The old secret stops working immediately, and integrations must be updated."
        confirmLabel="Rotate"
        onConfirm={async () => {
          if (!record) return
          const revealed = revealedIvrSigningSecretFromResult(
            await rotate({ organizationId: activeTeamId!, id: record.id })
          )
          if (revealed) record.reveal(revealed)
        }}
      />
    </div>
  )
}
