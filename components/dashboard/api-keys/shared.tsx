"use client"

import * as React from "react"
import type { Id } from "@/convex/_generated/dataModel"
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
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import { maskToken, permissionLabel } from "@/lib/dashboard/format"
import { useDomain, useDomainOptions } from "@/lib/domains/use-domains"
import type { ApiKey, ApiKeyPermission, Domain } from "@/lib/dashboard/types"

import { API_RESOURCES, scopeAllows, scopeLabel } from "@/lib/api-scopes"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

export function ApiKeyPermissionLabel({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.permission !== "custom") return permissionLabel(apiKey.permission)
  const scopes = apiKey.scopes ?? []
  return (
    <Tooltip>
      <TooltipTrigger render={<span />} tabIndex={0}>
        Custom · {scopes.length} scopes
      </TooltipTrigger>
      <TooltipContent>
        {scopes.length
          ? scopes.map(scopeLabel).join(", ")
          : "No resource access"}
      </TooltipContent>
    </Tooltip>
  )
}

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

export type ApiKeyFormValues = {
  name: string
  permission: ApiKeyPermission
  domainId: string | null
  scopes: string[]
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
  onSubmit: (values: ApiKeyFormValues) => Promise<void>
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
  onSubmit: (values: ApiKeyFormValues) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [domainSearch, setDomainSearch] = React.useState("")
  const [name, setName] = React.useState(apiKey?.name ?? "")
  const [permission, setPermission] = React.useState<ApiKeyPermission>(
    apiKey?.permission ?? "full_access"
  )
  const [domainId, setDomainId] = React.useState<string | null>(
    apiKey?.domainId ?? null
  )
  const [scopes, setScopes] = React.useState<string[]>(apiKey?.scopes ?? [])
  const domains = useDomainOptions({
    search: domainSearch,
    selectedId: domainId ? (domainId as Id<"domains">) : undefined,
  })
  const selectedDomain = useDomain(domainId)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const domainAllowed =
    permission === "sending_access" ||
    (permission === "custom" && scopeAllows(scopes, "emails", "write"))

  const scopeError =
    permission === "custom" &&
    !scopes.length &&
    error === "Choose at least one resource scope for a Custom API key"
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!name.trim()) {
      setError("Enter a name")
      return
    }
    if (permission === "custom" && !scopes.length) {
      setError("Choose at least one resource scope for a Custom API key")
      return
    }
    setPending(true)
    try {
      await onSubmit({
        name: name.trim().slice(0, 50),
        permission,
        domainId: domainAllowed ? domainId : null,
        scopes: permission === "custom" ? scopes : [],
      })
      onOpenChange(false)
    } catch (e) {
      toast.add({ type: "error", title: actionError(e) })
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogContent
      className={permission === "custom" ? "sm:max-w-2xl" : "sm:max-w-md"}
    >
      <form onSubmit={submit} className="flex max-h-[85dvh] flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Keys authenticate the REST API and SMTP. The token is shown once.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="min-h-0 overflow-y-auto py-4">
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
            {error && !scopeError ? <FieldError>{error}</FieldError> : null}
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
                <span>
                  <b className="font-medium">Custom</b>: choose read or write
                  access per resource. Write includes read.
                </span>
              </InfoTip>
            </div>
            <OptionSelect
              id="api-key-permission"
              className="w-full"
              value={permission}
              onChange={(next) => {
                setPermission(next as ApiKeyPermission)
                setError(null)
              }}
              items={PERMISSION_ITEMS}
            />
          </Field>
          {permission === "custom" ? (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Resource scopes</FieldLabel>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setScopes(API_RESOURCES.map(({ id }) => `${id}:read`))
                    }
                  >
                    Set all to Read
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setScopes([])}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              {scopeError ? <FieldError>{error}</FieldError> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {API_RESOURCES.map((resource, index) => (
                    <React.Fragment key={resource.id}>
                      {index === 0 ||
                      API_RESOURCES[index - 1].group !== resource.group ? (
                        <TableRow>
                          <TableHead colSpan={2}>{resource.group}</TableHead>
                        </TableRow>
                      ) : null}
                      <TableRow>
                        <TableCell className="whitespace-normal">
                          <span>{resource.label}</span>
                          <FieldDescription>
                            {resource.description}
                          </FieldDescription>
                        </TableCell>
                        <TableCell>
                          <ToggleGroup
                            aria-label={`${resource.label} access`}
                            variant="outline"
                            size="sm"
                            spacing={0}
                            value={[
                              scopeAllows(scopes, resource.id, "write")
                                ? "write"
                                : scopeAllows(scopes, resource.id, "read")
                                  ? "read"
                                  : "none",
                            ]}
                            onValueChange={(values) => {
                              const access = values[0]
                              if (!access) return
                              setError(null)
                              setScopes((current) => [
                                ...current.filter(
                                  (s) => !s.startsWith(`${resource.id}:`)
                                ),
                                ...(access === "none"
                                  ? []
                                  : [`${resource.id}:${access}`]),
                              ])
                            }}
                          >
                            <ToggleGroupItem
                              value="none"
                              aria-label={`${resource.label} None`}
                            >
                              None
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="read"
                              aria-label={`${resource.label} Read`}
                            >
                              Read
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="write"
                              aria-label={`${resource.label} Write`}
                            >
                              Write
                            </ToggleGroupItem>
                          </ToggleGroup>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
              <FieldDescription>
                Write includes read. API keys and team settings require Full
                access.
              </FieldDescription>
            </Field>
          ) : null}
          {domainAllowed ? (
            <Field>
              <FieldLabel htmlFor="api-key-domain">Domain</FieldLabel>
              <OptionSelect
                search={{ onChange: setDomainSearch }}
                id="api-key-domain"
                className="w-full"
                value={domainId ?? ALL_DOMAINS}
                onChange={(next) =>
                  setDomainId(next === ALL_DOMAINS ? null : next)
                }
                items={domainItems(domains)}
                selectedItem={
                  selectedDomain
                    ? {
                        value: selectedDomain.id,
                        label: selectedDomain.name,
                      }
                    : undefined
                }
              />
              <FieldDescription>
                Sending access and Custom with Emails Write can be restricted to
                a single sending domain.
              </FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** The one moment the secret exists in the UI. */
export function ViewApiKeyDialog({
  token,
  onOpenChange,
  title = "View API Key",
  description = "Use it as a bearer token, or as the SMTP password.",
  fieldLabel = "API Key",
  secretLabel = "API key",
  fieldId = "api-key-token",
  alertTitle = "You can only see this key once.",
  alertDescription = "Store it somewhere safe.",
}: {
  token: string | null
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  fieldLabel?: string
  secretLabel?: string
  fieldId?: string
  alertTitle?: string
  alertDescription?: string
}) {
  /* Hold the last token through the close animation, so the field does not
     blank out on its way off screen. The key resets the reveal toggle. */
  const [shown, setShown] = React.useState(token)
  if (token !== null && token !== shown) setShown(token)

  return (
    <Dialog open={token !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>{alertTitle}</AlertTitle>
          <AlertDescription>{alertDescription}</AlertDescription>
        </Alert>
        <Field>
          <FieldLabel htmlFor={fieldId}>{fieldLabel}</FieldLabel>
          <SecretField
            key={shown ?? "empty"}
            id={fieldId}
            label={secretLabel}
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
