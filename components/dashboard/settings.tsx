"use client"

import * as React from "react"
import { OAuthAppsList } from "./oauth-apps"
import Link from "next/link"
import {
  SendIcon,
  XIcon,
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
import {
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"
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
import { useMutation, useAction } from "convex/react"
import { authClient, authResult } from "@/lib/auth/client"
import { api } from "@/convex/_generated/api"
import { useWorkspace } from "@/components/auth/workspace"
import { actionError } from "@/lib/action-error"
import { AVATAR_TYPES, readAvatar } from "@/lib/dashboard/avatar"
import { formatDate, roleLabel } from "@/lib/dashboard/format"
import { SETTINGS_NAV } from "@/lib/dashboard/nav"
import { slugify } from "@/lib/dashboard/slug"
import { useDashboard } from "@/lib/dashboard/store"
import type { Team, TeamMember } from "@/lib/dashboard/types"

const SMTP_PORT_ITEMS = [
  { value: "465", label: "465 · implicit TLS" },
  { value: "587", label: "587 · STARTTLS" },
]

export function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <SectionChrome title="Settings" tabs={SETTINGS_NAV}>
      {children}
    </SectionChrome>
  )
}

function SettingsLead({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-2xl text-small text-muted-foreground">{children}</p>
  )
}

function TeamOverview({ team }: { team: Team }) {
  const { setTeamAvatar } = useDashboard()
  const rename = useMutation(api.teams.rename)
  const [pending, setPending] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const admin = team.role === "admin"
  const file = React.useRef<HTMLInputElement>(null)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const teamName = String(form.get("teamName") ?? "").trim()
    const teamSlug = slugify(String(form.get("teamSlug") ?? ""))
    if (!teamName || !teamSlug) {
      toast.add({ type: "error", title: "Enter a team name and a slug" })
      return
    }
    setPending(true)
    try {
      await rename({ organizationId: team.id, name: teamName, slug: teamSlug })
      toast.add({ type: "success", title: "Team saved" })
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={save}>
      <SettingsCard
        title="Overview"
        footer={
          <Button type="submit" disabled={!admin || pending || uploading}>
            Save
          </Button>
        }
      >
        <Field>
          <FieldLabel>Avatar</FieldLabel>
          <div className="flex items-center gap-4">
            <TeamGlyph team={team} className="size-20 rounded-2xl text-2xl" />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!admin || pending || uploading}
                  onClick={() => file.current?.click()}
                >
                  <UploadIcon data-icon="inline-start" />
                  Update image
                </Button>
                {team.avatar ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!admin || pending || uploading}
                    onClick={async () => {
                      setUploading(true)
                      try {
                        await setTeamAvatar(team.id, undefined)
                        toast.add({ type: "success", title: "Avatar removed" })
                      } catch (error) {
                        toast.add({ type: "error", title: actionError(error) })
                      } finally {
                        setUploading(false)
                      }
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <FieldDescription>Maximum file size is 1MB.</FieldDescription>
            </div>
            <Input
              ref={file}
              type="file"
              accept={AVATAR_TYPES.join(",")}
              className="sr-only"
              aria-label="Team avatar"
              tabIndex={-1}
              onChange={async (event) => {
                const picked = event.target.files?.[0]
                event.target.value = ""
                if (!picked) return
                setUploading(true)
                try {
                  await setTeamAvatar(team.id, await readAvatar(picked))
                  toast.add({ type: "success", title: "Avatar updated" })
                } catch (error) {
                  toast.add({ type: "error", title: actionError(error) })
                } finally {
                  setUploading(false)
                }
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
              required
              maxLength={100}
              key={team.name}
              defaultValue={team.name}
              disabled={!admin || pending || uploading}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="team-slug">Slug</FieldLabel>
            <Input
              id="team-slug"
              name="teamSlug"
              required
              className="font-mono"
              key={team.slug}
              defaultValue={team.slug}
              disabled={!admin || pending || uploading}
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
  const { state, updateMemberRole, removeMember } = useDashboard()
  const [tab, setTab] = React.useState<string>("members")
  const [inviting, setInviting] = React.useState(false)
  const [removing, setRemoving] = React.useState<TeamMember | null>(null)
  const [leaving, setLeaving] = React.useState(false)
  const [changingRole, setChangingRole] = React.useState(false)
  const admin = team.role === "admin"

  return (
    <>
      <SettingsCard
        flush
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
          admin && tab === "members" ? (
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
                const mfa = member.mfa
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
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!team.removable}
                              onClick={() => setLeaving(true)}
                            >
                              <LogOutIcon />
                              Leave team
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </MoreMenu>
                      ) : admin ? (
                        <MoreMenu>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              disabled={changingRole}
                              onClick={async () => {
                                setChangingRole(true)
                                try {
                                  await updateMemberRole(member.id, promoted)
                                  toast.add({
                                    type: "success",
                                    title: `Role changed to ${roleLabel(promoted)}`,
                                  })
                                } catch (error) {
                                  toast.add({
                                    type: "error",
                                    title: actionError(error),
                                  })
                                } finally {
                                  setChangingRole(false)
                                }
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
                          </DropdownMenuGroup>
                        </MoreMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : admin ? (
          <OAuthAppsList key={team.id} organizationId={team.id} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            Only team admins can view and manage authorized apps.
          </p>
        )}
      </SettingsCard>
      <InviteMemberDialog open={inviting} onOpenChange={setInviting} />
      <DeleteTeamDialog
        team={leaving ? team : null}
        leaving
        onClose={() => setLeaving(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null)
        }}
        title="Remove from team?"
        description={`${removing?.email ?? "They"} will lose access to this team.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removing) await removeMember(removing.id)
          toast.add({ type: "success", title: "Member removed" })
        }}
      />
    </>
  )
}

function TeamInvitations({ team }: { team: Team }) {
  const { invitations } = useWorkspace()
  const invite = useMutation(api.teams.invite)
  const cancel = useMutation(api.teams.cancelInvitation)
  const [pending, setPending] = React.useState<string | null>(null)
  async function update(id: string, resend: boolean) {
    const invitation = invitations.find((item) => item.id === id)
    if (!invitation) return
    setPending(id)
    try {
      if (resend)
        await invite({
          organizationId: team.id,
          email: invitation.email,
          role: invitation.role,
        })
      else await cancel({ invitationId: id })
      toast.add({
        type: "success",
        title: resend ? "Invitation resent" : "Invitation canceled",
      })
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setPending(null)
    }
  }
  return (
    <SettingsCard title="Invitations" flush>
      {invitations.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Expires</Th>
              <Th className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">
                  {invitation.email}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {roleLabel(invitation.role)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {invitation.status === "expired" ? "Expired" : "Pending"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invitation.expiresAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={pending !== null}
                        onClick={() => update(invitation.id, true)}
                      >
                        <SendIcon />
                        Resend invitation
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={pending !== null}
                        variant="destructive"
                        onClick={() => update(invitation.id, false)}
                      >
                        <XIcon />
                        Cancel invitation
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          size="sm"
          icon={SendIcon}
          title="No pending invitations"
          description="Invite someone from the Members section to add them to this team."
        />
      )}
    </SettingsCard>
  )
}

export function SettingsTeam() {
  const { activeTeam: team } = useDashboard()
  const [deleting, setDeleting] = React.useState(false)

  return (
    <>
      <TeamOverview team={team} />
      <TeamMembers team={team} />
      {team.role === "admin" && <TeamInvitations team={team} />}
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
        team={deleting ? team : null}
        onClose={() => setDeleting(false)}
      />
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
  const { activeTeam: team } = useDashboard()
  const { sso } = useWorkspace()
  const saveConnection = useAction(api.sso.save)
  const enforce = useMutation(api.sso.enforce)
  const [pending, setPending] = React.useState(false)
  const admin = team.role === "admin"
  return (
    <>
      <SettingsLead>
        Let the team sign in with your identity provider. Test the connection
        before requiring SSO.
      </SettingsLead>
      <form
        className="max-w-lg"
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setPending(true)
          try {
            await saveConnection({
              organizationId: team.id,
              issuer: String(form.get("issuer")),
              clientId: String(form.get("clientId")),
              clientSecret: String(form.get("clientSecret")),
            })
            toast.add({
              type: "success",
              title: "Connection saved. Test sign-in before enabling SSO.",
            })
          } catch (error) {
            toast.add({ type: "error", title: actionError(error) })
          } finally {
            setPending(false)
          }
        }}
      >
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
              checked={sso?.enforced ?? false}
              disabled={!admin || !sso?.tested || pending}
              onCheckedChange={async (enabled) => {
                setPending(true)
                try {
                  await enforce({ organizationId: team.id, enabled })
                  toast.add({
                    type: "success",
                    title: enabled ? "SSO enabled" : "SSO disabled",
                  })
                } catch (error) {
                  toast.add({ type: "error", title: actionError(error) })
                } finally {
                  setPending(false)
                }
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sso-issuer">Issuer URL</FieldLabel>
            <Input
              id="sso-issuer"
              name="issuer"
              type="url"
              key={sso?.issuer}
              defaultValue={sso?.issuer ?? ""}
              placeholder="https://idp.example.com"
              required
              disabled={!admin || pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sso-client">Client ID</FieldLabel>
            <Input
              id="sso-client"
              name="clientId"
              key={sso?.clientId}
              defaultValue={sso?.clientId ?? ""}
              required
              disabled={!admin || pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sso-secret">Client secret</FieldLabel>
            <Input
              id="sso-secret"
              name="clientSecret"
              type="password"
              autoComplete="off"
              required
              disabled={!admin || pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sso-callback">Callback URL</FieldLabel>
            <Input
              id="sso-callback"
              readOnly
              value={`${typeof window === "undefined" ? "" : window.location.origin}/api/auth/oauth2/callback/${team.id}`}
            />
            <FieldDescription>
              Register this URL with your identity provider.
            </FieldDescription>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!admin || pending}>
              Save connection
            </Button>
            {sso && (
              <Button
                type="button"
                variant="outline"
                disabled={!admin || pending}
                onClick={async () => {
                  setPending(true)
                  try {
                    await authResult(
                      await authClient.signIn.oauth2({
                        providerId: team.id,
                        callbackURL: "/settings/sso",
                      })
                    )
                  } catch (error) {
                    toast.add({ type: "error", title: actionError(error) })
                  } finally {
                    setPending(false)
                  }
                }}
              >
                Test connection
              </Button>
            )}
          </div>
          <FieldDescription>
            {sso?.tested
              ? "Connection test passed."
              : "Complete a test sign-in before enabling SSO."}
          </FieldDescription>
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
