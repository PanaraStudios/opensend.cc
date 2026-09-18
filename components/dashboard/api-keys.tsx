"use client"

import * as React from "react"
import { KeyRoundIcon, PlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ListToolbar,
  MoreMenu,
  OptionSelect,
  PageHeader,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { formatDate, maskToken, permissionLabel } from "@/lib/dashboard/format"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
import type { ApiKey, ApiKeyPermission } from "@/lib/dashboard/types"

function PermissionFields({
  permission,
  setPermission,
  domainId,
  setDomainId,
}: {
  permission: ApiKeyPermission
  setPermission: (value: ApiKeyPermission) => void
  domainId: string | null
  setDomainId: (value: string | null) => void
}) {
  const { state } = useDashboard()
  const verified = state.domains.filter(
    (domain) => domain.status === "verified"
  )

  return (
    <>
      <Field>
        <FieldLabel>Permission</FieldLabel>
        <RadioGroup
          value={permission}
          onValueChange={(value) => setPermission(value as ApiKeyPermission)}
          className="gap-3"
        >
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="full_access" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Full access</span>
              <span className="text-sm text-muted-foreground">
                Create, delete, get, and update any resource.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="sending_access" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Sending access</span>
              <span className="text-sm text-muted-foreground">
                Can only send email. Prefer this for apps and CI.
              </span>
            </span>
          </label>
        </RadioGroup>
      </Field>
      {permission === "sending_access" ? (
        <Field>
          <FieldLabel htmlFor="key-domain">Restrict to domain</FieldLabel>
          <OptionSelect
            id="key-domain"
            className="w-full"
            value={domainId ?? "all"}
            onChange={(next) => setDomainId(next === "all" ? null : next)}
            items={[
              { value: "all", label: "All domains" },
              ...verified.map((domain) => ({
                value: domain.id,
                label: domain.name,
              })),
            ]}
          />
          <FieldDescription>
            Optional. Only used with sending access.
          </FieldDescription>
        </Field>
      ) : null}
    </>
  )
}

export function CreateApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { createApiKey } = useDashboard()
  const [name, setName] = React.useState("")
  const [permission, setPermission] =
    React.useState<ApiKeyPermission>("sending_access")
  const [domainId, setDomainId] = React.useState<string | null>(null)
  const [token, setToken] = React.useState<string | null>(null)

  function reset() {
    setName("")
    setPermission("sending_access")
    setDomainId(null)
    setToken(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const result = createApiKey({
      name: name.trim().slice(0, 50),
      permission,
      domainId,
    })
    setToken(result.token)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy this token now. Opensend stores only a hash — the secret is
                not shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {token}
              </code>
              <CopyButton value={token} label="API key" />
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Keys authenticate the Resend-compatible API and SMTP. Sending
                access cannot create full-access keys.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="key-name">Name</FieldLabel>
                <Input
                  id="key-name"
                  value={name}
                  maxLength={50}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Production"
                  autoFocus
                />
                <FieldDescription>Maximum 50 characters.</FieldDescription>
              </Field>
              <PermissionFields
                permission={permission}
                setPermission={setPermission}
                domainId={domainId}
                setDomainId={setDomainId}
              />
            </FieldGroup>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={!name.trim()}>
                Create API key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditApiKeyForm({
  apiKey,
  onOpenChange,
}: {
  apiKey: ApiKey
  onOpenChange: (open: boolean) => void
}) {
  const { updateApiKey } = useDashboard()
  const [name, setName] = React.useState(apiKey.name)
  const [permission, setPermission] = React.useState<ApiKeyPermission>(
    apiKey.permission
  )
  const [domainId, setDomainId] = React.useState<string | null>(apiKey.domainId)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    updateApiKey(apiKey.id, {
      name: name.trim().slice(0, 50),
      permission,
      domainId,
    })
    toast.add({ type: "success", title: "API key updated" })
    onOpenChange(false)
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Edit API key</DialogTitle>
          <DialogDescription>
            You can change the name, permission, and domain restriction. The
            token itself cannot be viewed again.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="edit-key-name">Name</FieldLabel>
            <Input
              id="edit-key-name"
              value={name}
              maxLength={50}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <PermissionFields
            permission={permission}
            setPermission={setPermission}
            domainId={domainId}
            setDomainId={setDomainId}
          />
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function EditApiKeyDialog({
  apiKey,
  open,
  onOpenChange,
}: {
  apiKey: ApiKey | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {apiKey ? (
        <EditApiKeyForm
          key={apiKey.id}
          apiKey={apiKey}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  )
}

function lastUsedTone(
  lastUsedAt: number | null
): "success" | "secondary" | "warning" {
  if (lastUsedAt === null) return "secondary"
  const hours = (Date.now() - lastUsedAt) / 3_600_000
  if (hours < 24) return "success"
  return "warning"
}

const PERMISSION_ITEMS = [
  { value: "all", label: "All permissions" },
  ...(["full_access", "sending_access"] as ApiKeyPermission[]).map((value) => ({
    value,
    label: permissionLabel(value),
  })),
]

export function ApiKeysView() {
  const { state, deleteApiKey } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [permission, setPermission] = React.useState("all")
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ApiKey | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const rows = state.apiKeys.filter(
    (key) =>
      matchesNeedle(needle, key.name) &&
      (permission === "all" || key.permission === permission)
  )

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Authenticate REST and SMTP. Tokens are shown once. Only hashes are stored."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Create API key
        </Button>
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search keys…"
        filters={[
          {
            value: permission,
            onChange: setPermission,
            items: PERMISSION_ITEMS,
            "aria-label": "Filter by permission",
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={KeyRoundIcon}
          title="No API keys"
          description="Create a key to send through the Resend-compatible API or SMTP."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Create API key
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Token</Th>
              <Th>Permission</Th>
              <Th>Domain</Th>
              <Th>Last used</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((key) => {
            const domain = state.domains.find(
              (item) => item.id === key.domainId
            )
            return (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell>
                  <code className="font-mono text-[13px] text-muted-foreground">
                    {maskToken(key.tokenPrefix, key.tokenLast4)}
                  </code>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      key.permission === "full_access" ? "warning" : "secondary"
                    }
                  >
                    {permissionLabel(key.permission)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {domain?.name ?? "All"}
                </TableCell>
                <TableCell>
                  <Badge variant={lastUsedTone(key.lastUsedAt)} dot>
                    {key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(key.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuItem onClick={() => setEditing(key)}>
                      Edit API key
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPendingDelete(key.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </ResourceTable>
      )}
      <CreateApiKeyDialog open={open} onOpenChange={setOpen} />
      <EditApiKeyDialog
        apiKey={editing}
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete API key?"
        description="Requests signed with this token will fail immediately. Create a replacement before you delete a live key."
        onConfirm={() => {
          if (pendingDelete) deleteApiKey(pendingDelete)
          toast.add({ type: "success", title: "API key deleted" })
        }}
      />
    </>
  )
}
