"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmptyState,
  MoreMenu,
  MoreMenuItem,
  ExportStatusBadge,
  PageHeader,
  ResourceTable,
  Surface,
  Th,
} from "@/components/dashboard/primitives"
import { SETTINGS_NAV, pathMatches } from "@/lib/dashboard/nav"
import { formatDate, initials, isEmail, regionLabel, roleLabel } from "@/lib/dashboard/format"
import { REGIONS } from "@/lib/dashboard/types"
import type { MemberRole, Region } from "@/lib/dashboard/types"
import { useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UsersIcon } from "lucide-react"

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="w-full shrink-0 border-double-b md:w-56 md:border-r md:border-b-0 md:border-double-r">
        <div className="px-6 py-6 md:px-5">
          <h1 className="title-gradient text-h4">Settings</h1>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-6">
          {SETTINGS_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
                pathMatches(pathname, item.href) &&
                  "bg-muted font-medium text-foreground"
              )}
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-6 p-6 md:p-8">
        {children}
      </div>
    </div>
  )
}

export function SettingsGeneral() {
  const { state, updateSettings } = useDashboard()

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const teamName = String(form.get("teamName") ?? "").trim()
    const teamSlug = String(form.get("teamSlug") ?? "").trim().toLowerCase()
    updateSettings({
      teamName: teamName || state.settings.teamName,
      teamSlug: teamSlug || state.settings.teamSlug,
    })
    toast.add({ type: "success", title: "Workspace saved" })
  }

  return (
    <>
      <PageHeader
        title="General"
        description="Workspace identity. Self-hosted Opensend keeps this on your Convex deployment — nothing is sent to us."
      />
      <form onSubmit={save} className="max-w-lg">
        <Surface>
        <Field>
          <FieldLabel htmlFor="team-name">Workspace name</FieldLabel>
          <Input
            id="team-name"
            name="teamName"
            key={state.settings.teamName}
            defaultValue={state.settings.teamName}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="team-slug">Slug</FieldLabel>
          <Input
            id="team-slug"
            name="teamSlug"
            key={state.settings.teamSlug}
            defaultValue={state.settings.teamSlug}
          />
          <FieldDescription>
            Used in the sidebar and future invite URLs.
          </FieldDescription>
        </Field>
        <Button type="submit">Save</Button>
        </Surface>
      </form>
    </>
  )
}

export function SettingsTeam() {
  const { state, inviteMember, updateMemberRole, removeMember } = useDashboard()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<MemberRole>("member")
  const [error, setError] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter a name")
      return
    }
    if (!isEmail(email)) {
      setError("Enter a valid email")
      return
    }
    if (
      state.members.some(
        (member) => member.email === email.trim().toLowerCase()
      )
    ) {
      setError("That person is already on the team")
      return
    }
    inviteMember({ name, email, role })
    toast.add({ type: "success", title: "Member invited" })
    setName("")
    setEmail("")
    setRole("member")
    setError(null)
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Admins can invite members and change roles. Authorization is always checked server-side once auth is wired."
      >
        <Button onClick={() => setOpen(true)}>Invite</Button>
      </PageHeader>
      {state.members.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No members"
          description="Invite someone to this workspace."
        />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Added</Th>
              <Th className="w-10" />
            </>
          }
        >
          {state.members.map((member) => (
            <TableRow key={member.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar size="sm">
                    <AvatarFallback>{initials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">
                      {member.name}
                      {member.you ? (
                        <Badge variant="secondary" className="ml-2">
                          You
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {member.email}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {member.you ? (
                  <span className="text-sm text-muted-foreground">
                    {roleLabel(member.role)}
                  </span>
                ) : (
                  <select
                    value={member.role}
                    onChange={(event) =>
                      updateMemberRole(
                        member.id,
                        event.target.value as MemberRole
                      )
                    }
                    className="h-8 rounded-lg border border-input bg-background px-2 text-[13px] dark:bg-surface"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(member.createdAt)}
              </TableCell>
              <TableCell>
                {member.you ? null : (
                  <MoreMenu>
                    <MoreMenuItem
                      variant="destructive"
                      onClick={() => setPendingDelete(member.id)}
                    >
                      Remove
                    </MoreMenuItem>
                  </MoreMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setError(null)
          }
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                They will get access to this workspace after they accept.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="invite-name">Name</FieldLabel>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setError(null)
                  }}
                />
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as MemberRole)
                  }
                  className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Send invite</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Remove member?"
        description="They will lose access to this workspace."
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingDelete) removeMember(pendingDelete)
          toast.add({ type: "success", title: "Member removed" })
        }}
      />
    </>
  )
}

export function SettingsSes() {
  const { state, updateSes } = useDashboard()
  const ses = state.settings.ses

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const region = String(form.get("region") ?? ses.region) as Region
    const configurationSet = String(form.get("configurationSet") ?? "").trim()
    const accessKey = String(form.get("accessKey") ?? "").trim()
    updateSes({
      connected: true,
      region,
      configurationSet,
      accessKeyLast4: accessKey
        ? accessKey.slice(-4).toUpperCase()
        : ses.accessKeyLast4,
    })
    toast.add({ type: "success", title: "SES connection saved" })
  }

  return (
    <>
      <PageHeader
        title="Amazon SES"
        description="Connect the AWS account that pays for delivery. Credentials stay on this server. API callers never receive them."
      />
      <form onSubmit={save} className="max-w-lg">
        <Surface>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Connection</span>
          <Badge variant={ses.connected ? "success" : "warning"} dot>
            {ses.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <Field>
          <FieldLabel htmlFor="ses-region">Region</FieldLabel>
          <select
            id="ses-region"
            name="region"
            key={ses.region}
            defaultValue={ses.region}
            className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
          >
            {REGIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label} ({item.code})
              </option>
            ))}
          </select>
          <FieldDescription>
            Current: {regionLabel(ses.region)}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ses-key">Access key</FieldLabel>
          <Input
            id="ses-key"
            name="accessKey"
            type="password"
            autoComplete="off"
            placeholder={
              ses.accessKeyLast4
                ? `Stored key ending in ${ses.accessKeyLast4}`
                : "AKIA…"
            }
          />
          <FieldDescription>
            Leave blank to keep the existing key. Only the last four characters
            are displayed after save.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ses-config">Configuration set</FieldLabel>
          <Input
            id="ses-config"
            name="configurationSet"
            key={ses.configurationSet}
            defaultValue={ses.configurationSet}
            placeholder="opensend-prod"
          />
          <FieldDescription>
            Used for event publishing (bounces, complaints, deliveries).
          </FieldDescription>
        </Field>
        <Button type="submit">Save connection</Button>
        </Surface>
      </form>
    </>
  )
}

export function SettingsSmtp() {
  const { state, updateSmtp } = useDashboard()
  const smtp = state.settings.smtp

  return (
    <>
      <PageHeader
        title="SMTP"
        description="Send through the same API keys using any SMTP client. Username is resend; the password is an Opensend API key."
      />
      <Surface className="max-w-lg">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="smtp-enabled">
            <span className="flex flex-col gap-1">
              Enable SMTP
              <FieldDescription>
                Disable to reject SMTP AUTH while leaving the HTTP API up.
              </FieldDescription>
            </span>
          </FieldLabel>
          <Switch
            id="smtp-enabled"
            checked={smtp.enabled}
            onCheckedChange={(checked) => updateSmtp({ enabled: checked })}
          />
        </Field>
        <Field>
          <FieldLabel>Host</FieldLabel>
          <Input readOnly value={smtp.host} />
        </Field>
        <Field>
          <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
          <select
            id="smtp-port"
            value={String(smtp.port)}
            onChange={(event) =>
              updateSmtp({
                port: Number(event.target.value) as 465 | 587,
              })
            }
            className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
          >
            <option value="465">465 · implicit TLS</option>
            <option value="587">587 · STARTTLS</option>
          </select>
        </Field>
        <Field>
          <FieldLabel>Username</FieldLabel>
          <Input readOnly value="resend" />
          <FieldDescription>
            Matches the Resend SMTP contract so existing clients keep working.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input readOnly value="Your Opensend API key" />
        </Field>
      </Surface>
    </>
  )
}

export function SettingsBilling() {
  const { state, updateSettings } = useDashboard()

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const billingEmail = String(form.get("billingEmail") ?? "").trim()
    if (billingEmail && !isEmail(billingEmail)) {
      toast.add({ type: "warning", title: "Enter a valid billing email" })
      return
    }
    updateSettings({
      billingEmail: billingEmail || state.settings.billingEmail,
    })
    toast.add({ type: "success", title: "Billing email saved" })
  }

  return (
    <>
      <PageHeader
        title="Billing"
        description="Self-hosted Opensend has no subscription. This page matches the Resend billing layout so Cloud can land later."
      />
      <Surface className="max-w-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Plan</span>
          <Badge variant="secondary">Self-hosted</Badge>
        </div>
        <p className="text-small text-muted-foreground">
          You pay Amazon for delivery. Nothing is billed to Opensend.
        </p>
        <form onSubmit={save} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="billing-email">Billing email</FieldLabel>
            <Input
              id="billing-email"
              name="billingEmail"
              type="email"
              key={state.settings.billingEmail}
              defaultValue={state.settings.billingEmail}
            />
            <FieldDescription>
              Invoices and usage notices for a future Cloud plan.
            </FieldDescription>
          </Field>
          <Button type="submit">Save</Button>
        </form>
      </Surface>
      <Surface className="max-w-lg">
        <h2 className="text-sm font-medium">Invoices</h2>
        <p className="text-small text-muted-foreground">
          No invoices on this deployment.
        </p>
      </Surface>
    </>
  )
}

export function SettingsSso() {
  const { state, updateSettings } = useDashboard()
  const sso = state.settings.sso

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    updateSettings({
      sso: {
        ...sso,
        issuer: String(form.get("issuer") ?? "").trim(),
        clientId: String(form.get("clientId") ?? "").trim(),
      },
    })
    toast.add({ type: "success", title: "SSO saved" })
  }

  return (
    <>
      <PageHeader
        title="Single Sign-On"
        description="Let the team sign in with your identity provider. Auth is not wired yet; this stores the connection locally."
      />
      <form onSubmit={save} className="max-w-lg">
        <Surface>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="sso-enabled">
              <span className="flex flex-col gap-1">
                Enable SSO
                <FieldDescription>
                  Members must use the identity provider once this is on.
                </FieldDescription>
              </span>
            </FieldLabel>
            <Switch
              id="sso-enabled"
              checked={sso.enabled}
              onCheckedChange={(checked) =>
                updateSettings({
                  sso: { ...sso, enabled: checked },
                })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sso-issuer">Issuer URL</FieldLabel>
            <Input
              id="sso-issuer"
              name="issuer"
              key={sso.issuer}
              defaultValue={sso.issuer}
              placeholder="https://idp.example.com"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sso-client">Client ID</FieldLabel>
            <Input
              id="sso-client"
              name="clientId"
              key={sso.clientId}
              defaultValue={sso.clientId}
            />
          </Field>
          <Button type="submit">Save connection</Button>
        </Surface>
      </form>
    </>
  )
}

export function SettingsUnsubscribe() {
  const { state, updateSettings } = useDashboard()
  const page = state.settings.unsubscribe

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    updateSettings({
      unsubscribe: {
        heading: String(form.get("heading") ?? page.heading),
        body: String(form.get("body") ?? page.body),
        brandName: String(form.get("brandName") ?? page.brandName),
      },
    })
    toast.add({ type: "success", title: "Unsubscribe page saved" })
  }

  return (
    <>
      <PageHeader
        title="Unsubscribe page"
        description="Contacts land here from broadcast footers. Public topics are listed so they can stay on the mail they want."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="flex h-full min-h-0 flex-col">
          <Surface>
            <Field>
              <FieldLabel htmlFor="unsub-brand">Brand name</FieldLabel>
              <Input
                id="unsub-brand"
                name="brandName"
                key={page.brandName}
                defaultValue={page.brandName}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="unsub-heading">Heading</FieldLabel>
              <Input
                id="unsub-heading"
                name="heading"
                key={page.heading}
                defaultValue={page.heading}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="unsub-body">Body</FieldLabel>
              <Input
                id="unsub-body"
                name="body"
                key={page.body}
                defaultValue={page.body}
              />
            </Field>
            <Button type="submit">Save</Button>
          </Surface>
        </form>
        <Surface>
          <p className="font-mono text-caption text-muted-foreground">Preview</p>
          <p className="text-small text-muted-foreground">{page.brandName}</p>
          <h2 className="text-h4">{page.heading}</h2>
          <p className="text-small text-muted-foreground">{page.body}</p>
          <ul className="space-y-2 text-sm">
            {state.topics
              .filter((topic) => topic.visibility === "public")
              .map((topic) => (
                <li key={topic.id} className="flex items-center justify-between">
                  <span>{topic.name}</span>
                  <Badge variant="secondary">Topic</Badge>
                </li>
              ))}
          </ul>
        </Surface>
      </div>
    </>
  )
}

export function SettingsExports() {
  const { state } = useDashboard()

  return (
    <>
      <PageHeader
        title="Exports"
        description="Admin exports from Emails, Broadcasts, Contacts, Segments, Domains, Logs, and API keys. Ready files stay available for 7 days."
      />
      {state.exports.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No exports"
          description="Use Export on a list page. Members can view the job; only admins can download."
        />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Resource</Th>
              <Th>Status</Th>
              <Th>Rows</Th>
              <Th>Created</Th>
              <Th>Expires</Th>
            </>
          }
        >
          {state.exports.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.resource}</TableCell>
              <TableCell>
                <ExportStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{item.rows}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.createdAt)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.expiresAt)}
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
    </>
  )
}
