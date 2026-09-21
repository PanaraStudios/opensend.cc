"use client"
import * as React from "react"
import { useAction } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { ChevronDownIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { AsyncForm, FormInput } from "@/components/auth/ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/dashboard/primitives"
import {
  AwsAccessSetup,
  ImportAwsCredentials,
} from "@/components/onboarding/aws-access-setup"
import { REGIONS, type Region } from "@/lib/dashboard/types"

export type SesStatus = FunctionReturnType<typeof api.installation.status>
export function SetupDetails({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Collapsible className="flex flex-col gap-3">
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
          />
        }
      >
        <ChevronDownIcon data-icon="inline-start" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function AwsConnectionForm({
  status,
  updating = false,
  onSaved,
}: {
  status: SesStatus
  updating?: boolean
  onSaved?: () => void
}) {
  const connect = useAction(api.installationActions.connect)
  const installation = status.installation
  const [kind, setKind] = React.useState(installation?.credentialKind ?? "keys")
  const [region, setRegion] = React.useState<Region>(
    installation?.defaultRegion ?? "us-east-1"
  )
  const [enabled, setEnabled] = React.useState<Region[]>([])
  const [imported, setImported] = React.useState<{
    accessKeyId: string
    secretAccessKey: string
    revision: number
  }>()
  const regions = [
    ...new Set([
      region,
      ...enabled,
      ...status.regions.map((row) => row.region),
    ]),
  ]
  return (
    <AsyncForm
      fullWidth
      submitLabel={updating ? "Save connection" : "Connect AWS"}
      success={false}
      onSubmit={async (form) => {
        await connect({
          expectedAccountId: String(form.get("accountId")),
          defaultRegion: region,
          regions,
          credentials:
            kind === "role"
              ? { kind: "role" }
              : {
                  kind: "keys",
                  accessKeyId: String(form.get("accessKeyId")).trim(),
                  secretAccessKey: String(form.get("secretAccessKey")).trim(),
                  ...(form.get("sessionToken")
                    ? { sessionToken: String(form.get("sessionToken")).trim() }
                    : {}),
                },
        })
        setImported(undefined)
        onSaved?.()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ses-connection-region">
            Sending region
          </FieldLabel>
          <OptionSelect
            id="ses-connection-region"
            value={region}
            onChange={(next) => setRegion(next as Region)}
            items={REGIONS.map((item) => ({
              value: item.value,
              label: `${item.label} (${item.value})`,
            }))}
          />
        </Field>
        {kind === "keys" && !updating && installation && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Need AWS access keys?
            </span>
            <AwsAccessSetup
              compact
              installationId={installation._id}
              defaultRegion={region}
              regions={regions}
            />
          </div>
        )}
        <FormInput
          name="accountId"
          label="AWS account ID"
          defaultValue={installation?.accountId}
          readOnly={updating}
          pattern="[0-9]{12}"
          maxLength={12}
          placeholder="123456789012"
        />
        {kind === "keys" && (
          <FieldSet>
            <FieldLegend className="flex w-full flex-wrap items-center justify-between gap-2">
              <span>AWS credentials</span>
              <ImportAwsCredentials
                onImport={(credentials) =>
                  setImported((previous) => ({
                    ...credentials,
                    revision: (previous?.revision ?? 0) + 1,
                  }))
                }
              />
            </FieldLegend>
            <FieldGroup>
              <FormInput
                key={`access-${imported?.revision}`}
                name="accessKeyId"
                label="Access key ID"
                defaultValue={imported?.accessKeyId}
                autoComplete="off"
                placeholder="AKIA…"
              />
              <FormInput
                key={`secret-${imported?.revision}`}
                name="secretAccessKey"
                label="Secret access key"
                defaultValue={imported?.secretAccessKey}
                type="password"
                autoComplete="new-password"
              />
            </FieldGroup>
            <FieldDescription>
              {updating
                ? "The current key stays active until the replacement passes validation."
                : "Stored securely. Never shared with your team members."}
            </FieldDescription>
          </FieldSet>
        )}
        <SetupDetails label="Advanced options">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ses-credential-kind">
                Connection method
              </FieldLabel>
              <OptionSelect
                id="ses-credential-kind"
                value={kind}
                onChange={(value) => setKind(value as "keys" | "role")}
                items={[
                  { value: "keys", label: "Access key" },
                  { value: "role", label: "Existing server role" },
                ]}
              />
              {kind === "role" && (
                <FieldDescription>
                  Your backend host must already provide AWS role credentials.
                </FieldDescription>
              )}
            </Field>
            {kind === "keys" && (
              <FormInput
                name="sessionToken"
                label="Session token (optional)"
                type="password"
                required={false}
                autoComplete="off"
              />
            )}
            <FieldSet>
              <FieldLegend>Additional regions</FieldLegend>
              <FieldGroup>
                {REGIONS.filter((item) => item.value !== region).map((item) => (
                  <Field key={item.value} orientation="horizontal">
                    <Checkbox
                      id={`enable-${item.value}`}
                      checked={
                        enabled.includes(item.value) ||
                        status.regions.some(
                          (saved) => saved.region === item.value
                        )
                      }
                      disabled={status.regions.some(
                        (saved) => saved.region === item.value
                      )}
                      onCheckedChange={(checked) =>
                        setEnabled((previous) =>
                          checked
                            ? [...previous, item.value]
                            : previous.filter((value) => value !== item.value)
                        )
                      }
                    />
                    <FieldLabel htmlFor={`enable-${item.value}`}>
                      {item.label}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </SetupDetails>
      </FieldGroup>
    </AsyncForm>
  )
}
