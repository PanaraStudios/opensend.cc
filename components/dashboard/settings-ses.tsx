"use client"
import * as React from "react"
import { useAction, useQuery } from "convex/react"
import { KeyRoundIcon, ShieldIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { AsyncForm } from "@/components/auth/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import {
  SettingsCard,
  MonoValue,
  RelativeTime,
  EmptyState,
} from "@/components/dashboard/primitives"
import { AwsConnectionForm } from "@/components/ses/connection-form"
import { DownloadIamPolicyButton } from "@/components/ses/credentials-help"
import { SesRegions } from "@/components/ses/regions"
import { TenantCleanup } from "@/components/onboarding/team-ses-status"

export function SettingsSes() {
  const status = useQuery(api.installation.status)
  const check = useAction(api.installationActions.checkEnvironment)
  const [editing, setEditing] = React.useState(false)
  if (!status) return <Skeleton className="h-64 max-w-3xl" />
  if (!status.admin)
    return (
      <EmptyState
        icon={ShieldIcon}
        title="Administrator access required"
        description="Only the installation administrator can manage the AWS connection."
      />
    )
  const installation = status.installation
  const connected = !!installation?.accountId
  const callbackOrigin = installation?.callbackOrigin
  return (
    <div className="flex max-w-3xl flex-col gap-6" data-testid="ses-settings">
      <p className="text-sm text-muted-foreground">
        Manage the AWS connection used by all teams.
      </p>
      <SettingsCard
        title="AWS connection"
        actions={
          <Badge variant={connected ? "success" : "warning"} dot>
            {connected ? "Connected" : "Not connected"}
          </Badge>
        }
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <KeyRoundIcon data-icon="inline-start" />
              Update connection
            </Button>
            {installation?.accountId && (
              <DownloadIamPolicyButton
                variant="ghost"
                installationId={installation._id}
                accountId={installation.accountId}
                regions={status.regions.map((region) => region.region)}
              />
            )}
          </div>
        }
      >
        <dl className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">AWS account</dt>
            <dd className="text-sm">
              <MonoValue copyValue={installation?.accountId}>
                {installation?.accountId ?? "Not connected"}
              </MonoValue>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Credentials</dt>
            <dd className="text-sm">
              {installation?.credentialKind === "role"
                ? "Server role"
                : installation?.accessKeyLast4
                  ? `Access key ending in ${installation.accessKeyLast4}`
                  : "Not configured"}
            </dd>
          </div>
        </dl>
      </SettingsCard>
      <SettingsCard
        title="Sending regions"
        description="Account limits and delivery status for each region."
      >
        <SesRegions status={status} settings />
      </SettingsCard>
      <SettingsCard
        title="Delivery updates"
        description="AWS sends delivery and bounce events to this address."
        footer={
          callbackOrigin ? (
            <AsyncForm
              submitLabel="Check connection"
              success="Connection checked"
              onSubmit={() => check({ callbackOrigin })}
            />
          ) : undefined
        }
      >
        <div className="min-w-0 text-sm break-all">
          <MonoValue copyValue={callbackOrigin}>
            {callbackOrigin || "Not configured"}
          </MonoValue>
        </div>
        {!!installation?.environmentCheckedAt && (
          <p className="text-xs text-muted-foreground">
            Last checked <RelativeTime at={installation.environmentCheckedAt} />
          </p>
        )}
      </SettingsCard>
      <TenantCleanup />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update AWS connection</DialogTitle>
            <DialogDescription>
              Validate a replacement key or update your sending regions.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65svh] overflow-y-auto py-1">
            {editing && (
              <AwsConnectionForm
                status={status}
                updating
                onSaved={() => {
                  setEditing(false)
                  toast.add({
                    type: "success",
                    title: "AWS connection updated",
                  })
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
