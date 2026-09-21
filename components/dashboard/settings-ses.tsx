"use client"
import * as React from "react"
import { useAction, useQuery } from "convex/react"
import { DownloadIcon, KeyRoundIcon } from "lucide-react"
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
} from "@/components/dashboard/primitives"
import { downloadTextFile } from "@/components/dashboard/domains/shared"
import { AwsConnectionForm } from "@/components/ses/connection-form"
import { SesRegions } from "@/components/ses/regions"
import { TenantCleanup } from "@/components/onboarding/team-ses-status"
import { buildAwsIamPolicy } from "@/lib/aws/setup"

export function SettingsSes() {
  const status = useQuery(api.installation.status)
  const check = useAction(api.installationActions.checkEnvironment)
  const [editing, setEditing] = React.useState(false)
  if (!status) return <Skeleton className="h-64 max-w-3xl" />
  const installation = status.installation
  const connected = !!installation?.accountId
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
          status.admin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <KeyRoundIcon data-icon="inline-start" />
                Update connection
              </Button>
              {installation?.accountId && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadTextFile(
                      "opensend-iam-policy.json",
                      JSON.stringify(
                        buildAwsIamPolicy(
                          installation._id,
                          status.regions.map((region) => region.region),
                          installation.accountId!
                        ),
                        null,
                        2
                      ) + "\n"
                    )
                  }
                >
                  <DownloadIcon data-icon="inline-start" />
                  Download permissions
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Managed by your installation administrator.
            </p>
          )
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
          status.admin && installation?.callbackOrigin ? (
            <AsyncForm
              submitLabel="Check connection"
              success="Connection checked"
              onSubmit={() =>
                check({ callbackOrigin: installation.callbackOrigin })
              }
            />
          ) : undefined
        }
      >
        <div className="min-w-0 text-sm break-all">
          <MonoValue copyValue={installation?.callbackOrigin}>
            {installation?.callbackOrigin || "Not configured"}
          </MonoValue>
        </div>
        {!!installation?.environmentCheckedAt && (
          <p className="text-xs text-muted-foreground">
            Last checked <RelativeTime at={installation.environmentCheckedAt} />
          </p>
        )}
      </SettingsCard>
      {status.admin && <TenantCleanup />}
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
