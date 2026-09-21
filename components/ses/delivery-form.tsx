"use client"
import { useAction } from "convex/react"
import { TerminalIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { AsyncForm, FormInput } from "@/components/auth/ui"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { CopyButton } from "@/components/dashboard/primitives"
import { SetupDetails, type SesStatus } from "./connection-form"

export function DeliveryUrlForm({
  status,
  onSaved,
}: {
  status: SesStatus
  onSaved?: () => void
}) {
  const check = useAction(api.installationActions.checkEnvironment)
  const detected =
    status.installation?.callbackOrigin || status.suggestedCallbackOrigin
  const publicUrl = detected.startsWith("https://") ? detected : ""
  let port = "3211"
  try {
    port = new URL(status.suggestedCallbackOrigin).port || port
  } catch {}
  const command = `cloudflared tunnel --url http://localhost:${port}`
  return (
    <div className="flex flex-col gap-5">
      {!publicUrl && (
        <Alert>
          <TerminalIcon />
          <AlertTitle>Start a local tunnel</AlertTitle>
          <AlertDescription>
            <p>
              AWS cannot reach localhost. Run this command and keep it open:
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 text-xs break-all">
                {command}
              </code>
              <CopyButton value={command} label="Copy tunnel command" />
            </div>
          </AlertDescription>
        </Alert>
      )}
      <AsyncForm
        fullWidth
        submitLabel="Check URL and continue"
        success={false}
        onSubmit={async (form) => {
          await check({
            callbackOrigin: String(form.get("callbackOrigin")).trim(),
          })
          onSaved?.()
        }}
      >
        <FieldGroup>
          <FormInput
            name="callbackOrigin"
            label="Public backend URL"
            type="url"
            pattern="https://.+"
            title="Use an HTTPS URL for your Opensend backend"
            defaultValue={publicUrl}
            placeholder="https://your-tunnel.trycloudflare.com"
          />
          <FieldDescription>
            {publicUrl
              ? "Use the HTTPS address of your Opensend backend."
              : "Paste the HTTPS URL printed by your tunnel."}
          </FieldDescription>
        </FieldGroup>
      </AsyncForm>
      <SetupDetails label="Using a hosted backend?">
        <p className="text-sm text-muted-foreground">
          For Convex Cloud, use your deployment&apos;s .convex.site URL. For
          other hosts, use the public URL of the backend&apos;s HTTP service.
        </p>
      </SetupDetails>
    </div>
  )
}
