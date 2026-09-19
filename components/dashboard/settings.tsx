"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BlocksIcon,
  CircleCheckIcon,
  CircleXIcon,
  DownloadIcon,
  LogOutIcon,
  ShieldIcon,
  UploadIcon,
  UserMinusIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  EmptyState,
  ExportStatusBadge,
  MoreMenu,
  OptionSelect,
  PageHeader,
  ResourceTable,
  SectionChrome,
  SettingsCard,
  Surface,
  Th,
} from "@/components/dashboard/primitives"
import {
  DeleteTeamDialog,
  InviteMemberDialog,
  TeamGlyph,
} from "@/components/dashboard/team-dialogs"
import { readAvatar } from "@/lib/dashboard/avatar"
import { formatDate, regionLabel, roleLabel } from "@/lib/dashboard/format"
import { SETTINGS_NAV } from "@/lib/dashboard/nav"
import { slugify } from "@/lib/dashboard/slug"
import { useDashboard } from "@/lib/dashboard/store"
import { REGIONS } from "@/lib/dashboard/types"
import type { Region, Team, TeamMember } from "@/lib/dashboard/types"

const REGION_ITEMS = REGIONS.map((item) => ({
  value: item.value,
  label: `${item.label} (${item.code})`,
}))

const SMTP_PORT_ITEMS = [
  { value: "465", label: "465 · implicit TLS" },
  { value: "587", label: "587 · STARTTLS" },
]

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  /* A settings page that is not one of the tabs stands alone. */
  if (!SETTINGS_NAV.some((tab) => tab.href === pathname)) return <>{children}</>
  return (
    <SectionChrome title="Settings" tabs={SETTINGS_NAV}>
      {children}
    </SectionChrome>
  )
}

function SettingsLead({
  children,
  actions,
}: {
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <p className="max-w-2xl text-small text-muted-foreground">{children}</p>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  )
}

function TeamOverview() {
  const { state, teams, activeTeamId, updateSettings } = useDashboard()
  const team = teams.find((item) => item.id === activeTeamId)
  const admin = team?.role === "admin"
  const file = React.useRef<HTMLInputElement>(null)

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const teamName = String(form.get("teamName") ?? "").trim()
    const teamSlug = slugify(String(form.get("teamSlug") ?? ""))
    if (!teamName || !teamSlug) {
      toast.add({ type: "error", title: "Enter a team name and a slug" })
      return
    }
    if (
      teams.some((item) => item.id !== activeTeamId && item.slug === teamSlug)
    ) {
      toast.add({ type: "error", title: "That slug is already in use" })
      return
    }
    updateSettings({ teamName, teamSlug })
    toast.add({ type: "success", title: "Team saved" })
  }

  return (
    <form onSubmit={save}>
      <SettingsCard
        title="Overview"
        footer={
          <Button type="submit" disabled={!admin}>
            Save
          </Button>
        }
      >
        <Field>
          <FieldLabel>Avatar</FieldLabel>
          <div className="flex items-center gap-4">
            {team ? (
              <TeamGlyph team={team} className="size-20 rounded-2xl text-2xl" />
            ) : null}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!admin}
                  onClick={() => file.current?.click()}
                >
                  <UploadIcon data-icon="inline-start" />
                  Update image
                </Button>
                {state.settings.teamAvatar ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!admin}
                    onClick={() => updateSettings({ teamAvatar: undefined })}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <FieldDescription>Maximum file size is 1MB.</FieldDescription>
            </div>
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Team avatar"
              tabIndex={-1}
              onChange={(event) => {
                const picked = event.target.files?.[0]
                event.target.value = ""
                if (!picked) return
                readAvatar(picked).then(
                  (teamAvatar) => {
                    updateSettings({ teamAvatar })
                    toast.add({ type: "success", title: "Avatar updated" })
                  },
                  (problem: Error) =>
                    toast.add({ type: "error", title: problem.message })
                )
              }}
            />
          </div>
        </Field>
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="team-name">Team name</FieldLabel>
            <Input
              id="team-name"
              name="teamName"
              key={state.settings.teamName}
              defaultValue={state.settings.teamName}
              disabled={!admin}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="team-slug">Slug</FieldLabel>
            <Input
              id="team-slug"
              name="teamSlug"
              className="font-mono"
              key={state.settings.teamSlug}
              defaultValue={state.settings.teamSlug}
              disabled={!admin}
            />
          </Field>
        </div>
      </SettingsCard>
    </form>
  )
}

const MEMBER_TABS = [
  { value: "members", label: "Members" },
  { value: "authorized-apps", label: "Authorized apps" },
] as const

function TeamMembers({ team }: { team: Team }) {
  const { state, account, updateMemberRole, removeMember } = useDashboard()
  const [tab, setTab] = React.useState<string>("members")
  const [inviting, setInviting] = React.useState(false)
  const [removing, setRemoving] = React.useState<TeamMember | null>(null)
  const [leaving, setLeaving] = React.useState(false)
  const admin = team.role === "admin"

  return (
    <>
      <SettingsCard
        className="px-2"
        heading={
          <Tabs value={tab} onValueChange={(next) => next && setTab(next)}>
            <TabsList>
              {MEMBER_TABS.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        actions={
          admin ? (
            <Button onClick={() => setInviting(true)}>Invite</Button>
          ) : null
        }
      >
        {tab === "members" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Enabled MFA</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.members.map((member) => {
                const mfa = member.you ? account.mfa !== null : member.mfa
                const promoted = member.role === "admin" ? "member" : "admin"
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="font-medium">
                        {member.email}
                        {member.you ? (
                          <Badge variant="secondary" className="ml-2">
                            You
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Joined on {formatDate(member.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {roleLabel(member.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {mfa ? (
                        <CircleCheckIcon
                          aria-label="MFA enabled"
                          className="size-4 text-success"
                        />
                      ) : (
                        <CircleXIcon
                          aria-label="MFA not enabled"
                          className="size-4 text-muted-foreground"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {member.you ? (
                        <MoreMenu>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!team.removable}
                            onClick={() => setLeaving(true)}
                          >
                            <LogOutIcon />
                            Leave team
                          </DropdownMenuItem>
                        </MoreMenu>
                      ) : admin ? (
                        <MoreMenu>
                          <DropdownMenuItem
                            onClick={() => {
                              updateMemberRole(member.id, promoted)
                              toast.add({
                                type: "success",
                                title: `Role changed to ${roleLabel(promoted)}`,
                              })
                            }}
                          >
                            <ShieldIcon />
                            Change role to {roleLabel(promoted)}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setRemoving(member)}
                          >
                            <UserMinusIcon />
                            Remove from team
                          </DropdownMenuItem>
                        </MoreMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            size="sm"
            icon={BlocksIcon}
            title="No authorized apps"
            description="When someone on this team authorizes a third-party app, their consent will appear here."
          />
        )}
      </SettingsCard>
      <InviteMemberDialog open={inviting} onOpenChange={setInviting} />
      <DeleteTeamDialog
        team={team}
        leaving
        open={leaving}
        onOpenChange={setLeaving}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null)
        }}
        title="Remove from team?"
        description={`${removing?.email ?? "They"} will lose access to this team.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) removeMember(removing.id)
          toast.add({ type: "success", title: "Member removed" })
        }}
      />
    </>
  )
}

export function SettingsTeam() {
  const { teams, activeTeamId } = useDashboard()
  const [deleting, setDeleting] = React.useState(false)
  const team = teams.find((item) => item.id === activeTeamId)
  if (!team) return null

  return (
    <>
      <TeamOverview />
      <TeamMembers team={team} />
      <SettingsCard
        title="Exports"
        description="All available CSV exports for your team are listed here."
        footer={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/settings/exports" />}
          >
            Go to page
          </Button>
        }
      />
      {team.role === "admin" ? (
        <SettingsCard
          title="Delete team"
          description={
            team.removable
              ? "Permanently delete the team and all of its contents from Opensend."
              : "This is your only team. Create another one before deleting it."
          }
          footer={
            <Button
              variant="destructive"
              disabled={!team.removable}
              onClick={() => setDeleting(true)}
            >
              Delete team
            </Button>
          }
        />
      ) : null}
      <DeleteTeamDialog
        team={team}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </>
  )
}

export function SettingsSes() {
  const { state, updateSettings } = useDashboard()
  const ses = state.settings.ses

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const region = String(form.get("region") ?? ses.region) as Region
    const configurationSet = String(form.get("configurationSet") ?? "").trim()
    const accessKey = String(form.get("accessKey") ?? "").trim()
    updateSettings((current) => ({
      ...current,
      ses: {
        ...current.ses,
        connected: true,
        region,
        configurationSet,
        accessKeyLast4: accessKey
          ? accessKey.slice(-4).toUpperCase()
          : ses.accessKeyLast4,
      },
    }))
    toast.add({ type: "success", title: "SES connection saved" })
  }

  return (
    <>
      <SettingsLead>
        Connect the AWS account that pays for delivery. Credentials stay on this
        server. API callers never receive them.
      </SettingsLead>
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
            <OptionSelect
              id="ses-region"
              name="region"
              key={ses.region}
              className="w-full"
              defaultValue={ses.region}
              items={REGION_ITEMS}
            />
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
              Leave blank to keep the existing key. Only the last four
              characters are displayed after save.
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
  const { state, updateSettings } = useDashboard()
  const smtp = state.settings.smtp
  const updateSmtp = (patch: Partial<typeof smtp>) =>
    updateSettings((current) => ({
      ...current,
      smtp: { ...current.smtp, ...patch },
    }))

  return (
    <>
      <SettingsLead>
        Send through the same API keys using any SMTP client. Username is
        resend; the password is an Opensend API key.
      </SettingsLead>
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
          <OptionSelect
            id="smtp-port"
            className="w-full"
            value={String(smtp.port)}
            onChange={(next) => updateSmtp({ port: Number(next) as 465 | 587 })}
            items={SMTP_PORT_ITEMS}
          />
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
      <SettingsLead>
        Let the team sign in with your identity provider. Auth is not wired yet;
        this stores the connection locally.
      </SettingsLead>
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
      <SettingsLead>
        Contacts land here from broadcast footers. Public topics are listed so
        they can stay on the mail they want.
      </SettingsLead>
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="flex flex-col self-stretch">
          <Surface className="min-h-0 flex-1">
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
          <p className="font-mono text-caption text-muted-foreground">
            Preview
          </p>
          <p className="text-small text-muted-foreground">{page.brandName}</p>
          <h2 className="text-h4">{page.heading}</h2>
          <p className="text-small text-muted-foreground">{page.body}</p>
          <ul className="space-y-2 text-sm">
            {state.topics
              .filter((topic) => topic.visibility === "public")
              .map((topic) => (
                <li
                  key={topic.id}
                  className="flex items-center justify-between"
                >
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
        description="Exports from Emails, Broadcasts, Contacts, Segments, Domains, Logs, and API keys. Ready files stay available for 7 days."
      />
      {state.exports.length === 0 ? (
        <EmptyState
          icon={DownloadIcon}
          title="You haven't performed any exports yet"
          description="Once you execute an export, you'll be able to see them here."
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
              <TableCell className="text-muted-foreground">
                {item.rows}
              </TableCell>
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
