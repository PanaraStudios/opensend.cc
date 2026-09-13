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
  PageHeader,
  ResourceTable,
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
      <aside className="w-full shrink-0 border-b border-border md:w-56 md:border-r md:border-b-0">
        <div className="px-6 py-6 md:px-5">
          <h1 className="text-sm font-medium">Settings</h1>
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
      <form
        onSubmit={save}
        className="max-w-lg space-y-5 rounded-xl border border-border bg-surface p-6"
      >
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
      </form>
    </>
  )
}

export function SettingsTeam() {
  const { state, inviteMember, updateMemberRole, removeMember } = useDashboard()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<MemberRole>("developer")
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
    setRole("developer")
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
                    <option value="developer">Developer</option>
                    <option value="viewer">Viewer</option>
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
                  <option value="developer">Developer</option>
                  <option value="viewer">Viewer</option>
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
      <form
        onSubmit={save}
        className="max-w-lg space-y-5 rounded-xl border border-border bg-surface p-6"
      >
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
      <div className="max-w-lg space-y-5 rounded-xl border border-border bg-surface p-6">
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
      </div>
    </>
  )
}
