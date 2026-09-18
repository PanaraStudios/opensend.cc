"use client"

import * as React from "react"
import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  ConfirmDialog,
  DocsSheet,
  InfoTip,
  MonoValue,
  OptionSelect,
  SecretField,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  ALL_DOMAINS,
  ALL_DOMAINS_LABEL,
  ALL_PERMISSIONS,
  API_KEY_PERMISSIONS,
} from "@/lib/dashboard/api-keys"
import { maskToken, permissionLabel } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { ApiKey, ApiKeyPermission, Domain } from "@/lib/dashboard/types"

export const ApiKeyIcon = KeyRoundIcon

export const PERMISSION_ITEMS: readonly SelectOption[] =
  API_KEY_PERMISSIONS.map((value) => ({
    value,
    label: permissionLabel(value),
  }))

export const PERMISSION_FILTER_ITEMS: readonly SelectOption[] = [
  { value: ALL_PERMISSIONS, label: "All permissions" },
  ...PERMISSION_ITEMS,
]

export function domainItems(
  domains: readonly Domain[]
): readonly SelectOption[] {
  return [
    { value: ALL_DOMAINS, label: ALL_DOMAINS_LABEL },
    ...domains.map((domain) => ({ value: domain.id, label: domain.name })),
  ]
}

/** The visible half of a token: the prefix plus the last four characters.
    The secret itself is only ever shown once, right after it is created. */
export function ApiKeyToken({ apiKey }: { apiKey: ApiKey }) {
  return (
    <MonoValue>{maskToken(apiKey.tokenPrefix, apiKey.tokenLast4)}</MonoValue>
  )
}

const API_KEY_DOCS = [
  {
    title: "Permissions",
    body: "Full access can create, delete, get, and update any resource. Sending access can only send emails.",
  },
  {
    title: "Domains",
    body: "A sending key can be limited to one domain, so a leaked key cannot send from the rest of the workspace.",
  },
  {
    title: "Authorization",
    body: (
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
        {`curl https://api.opensend.cc/emails \\
  -H "Authorization: Bearer os_..." \\
  -H "Content-Type: application/json"`}
      </pre>
    ),
  },
  {
    title: "Rotation",
    body: "The token is shown once. Create a replacement, deploy it, then delete the old key.",
  },
]

export function ApiKeysDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="API keys"
      description="Bearer tokens for the REST API and SMTP."
      sections={API_KEY_DOCS}
    />
  )
}

export type ApiKeyFormValues = {
  name: string
  permission: ApiKeyPermission
  domainId: string | null
}

/** One form for adding and editing. The dialog mounts it only while open, so
    every reopen starts from the record it was given. */
export function ApiKeyFormDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  apiKey,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  submitLabel: string
  apiKey?: ApiKey | null
  onSubmit: (values: ApiKeyFormValues) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ApiKeyForm
          title={title}
          submitLabel={submitLabel}
          apiKey={apiKey ?? null}
          onSubmit={onSubmit}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  )
}

function ApiKeyForm({
  title,
  submitLabel,
  apiKey,
  onSubmit,
  onOpenChange,
}: {
  title: string
  submitLabel: string
  apiKey: ApiKey | null
  onSubmit: (values: ApiKeyFormValues) => void
  onOpenChange: (open: boolean) => void
}) {
  const { state } = useDashboard()
  const [name, setName] = React.useState(apiKey?.name ?? "")
  const [permission, setPermission] = React.useState<ApiKeyPermission>(
    apiKey?.permission ?? "full_access"
  )
  const [domainId, setDomainId] = React.useState<string | null>(
    apiKey?.domainId ?? null
  )
  const [error, setError] = React.useState<string | null>(null)
  const sendingOnly = permission === "sending_access"

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter a name")
      return
    }
    onSubmit({
      name: name.trim().slice(0, 50),
      permission,
      domainId: sendingOnly ? domainId : null,
    })
    onOpenChange(false)
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Keys authenticate the REST API and SMTP. The token is shown once.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
            <Input
              id="api-key-name"
              value={name}
              maxLength={50}
              placeholder="Your API Key name"
              autoFocus
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Field>
            <div className="flex items-center gap-1">
              <FieldLabel htmlFor="api-key-permission">Permission</FieldLabel>
              <InfoTip label="About permissions">
                <span>
                  <b className="font-medium">Full access</b>: can create,
                  delete, get, and update any resource.
                </span>
                <span>
                  <b className="font-medium">Sending access</b>: can only send
                  emails.
                </span>
              </InfoTip>
            </div>
            <OptionSelect
              id="api-key-permission"
              className="w-full"
              value={permission}
              onChange={(next) => setPermission(next as ApiKeyPermission)}
              items={PERMISSION_ITEMS}
            />
          </Field>
          <Field data-disabled={!sendingOnly}>
            <FieldLabel htmlFor="api-key-domain">Domain</FieldLabel>
            <OptionSelect
              id="api-key-domain"
              className="w-full"
              disabled={!sendingOnly}
              value={sendingOnly ? (domainId ?? ALL_DOMAINS) : ALL_DOMAINS}
              onChange={(next) =>
                setDomainId(next === ALL_DOMAINS ? null : next)
              }
              items={domainItems(state.domains)}
            />
            <FieldDescription>
              Only sending access can be restricted to a single domain.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit">{submitLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** The one moment the secret exists in the UI. */
export function ViewApiKeyDialog({
  token,
  onOpenChange,
}: {
  token: string | null
  onOpenChange: (open: boolean) => void
}) {
  /* Hold the last token through the close animation, so the field does not
     blank out on its way off screen. The key resets the reveal toggle. */
  const [shown, setShown] = React.useState(token)
  if (token !== null && token !== shown) setShown(token)

  return (
    <Dialog open={token !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>View API Key</DialogTitle>
          <DialogDescription>
            Use it as a bearer token, or as the SMTP password.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>You can only see this key once.</AlertTitle>
          <AlertDescription>Store it somewhere safe.</AlertDescription>
        </Alert>
        <Field>
          <FieldLabel htmlFor="api-key-token">API Key</FieldLabel>
          <SecretField
            key={shown ?? "empty"}
            id="api-key-token"
            label="API key"
            value={shown ?? ""}
          />
        </Field>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteApiKeyDialog({
  apiKey,
  open,
  onOpenChange,
  onConfirm,
}: {
  apiKey: ApiKey | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${apiKey?.name ?? "API key"}?`}
      description="Requests signed with this token start failing immediately. Create a replacement before you remove a live key."
      confirmLabel="Remove"
      onConfirm={onConfirm}
    />
  )
}
