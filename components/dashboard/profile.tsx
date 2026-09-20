"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { QRCodeSVG } from "qrcode.react"
import {
  BlocksIcon,
  Building2Icon,
  EyeIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  PencilIcon,
  SettingsIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import { authClient, authResult } from "@/lib/auth/client"
import { actionError } from "@/lib/action-error"
import { useWorkspace } from "@/components/auth/workspace"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  CodeWell,
  EmptyState,
  MonoValue,
  MoreMenu,
  PageHeader,
  SettingsCard,
  TextFieldDialog,
  Th,
  TypeToConfirmDialog,
  useDraftValue,
} from "@/components/dashboard/primitives"
import {
  DeleteTeamDialog,
  TeamGlyph,
} from "@/components/dashboard/team-dialogs"
import {
  formatDate,
  isEmail,
  normalizeEmail,
  roleLabel,
} from "@/lib/dashboard/format"
import { SETTINGS_NAV_INDEX } from "@/lib/dashboard/nav"
import { useDashboard } from "@/lib/dashboard/store"
import type { Team } from "@/lib/dashboard/types"

function EmailCard() {
  const { you, updateEmail } = useDashboard()
  const stored = you?.email ?? ""
  const { draft: email, setDraft: setEmail } = useDraftValue(
    stored,
    updateEmail
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const next = normalizeEmail(email)

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (!isEmail(next)) {
          setError("Enter a valid email address")
          return
        }
        setPending(true)
        setError(null)
        try {
          await updateEmail(next)
          toast.add({
            type: "success",
            title: "Check your email to confirm the change",
          })
        } catch (error) {
          setError(actionError(error))
        } finally {
          setPending(false)
        }
      }}
    >
      <SettingsCard
        title="Your email"
        footer={
          <Button type="submit" disabled={next === stored || pending}>
            Update email
          </Button>
        }
      >
        <Field className="max-w-md">
          <FieldLabel htmlFor="profile-email">Email address</FieldLabel>
          <Input
            id="profile-email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError(null)
            }}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </SettingsCard>
    </form>
  )
}

function TeamsCard() {
  const router = useRouter()
  const { teams, switchTeam, renameTeam } = useDashboard()
  const [renaming, setRenaming] = React.useState<Team | null>(null)
  const [leaving, setLeaving] = React.useState<Team | null>(null)

  const open = async (team: Team, href: string) => {
    try {
      await switchTeam(team.id)
      router.push(href)
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    }
  }

  return (
    <>
      <SettingsCard
        title="Teams"
        description="The teams that are associated with your account."
      >
        {teams.length === 0 && (
          <p className="text-sm text-muted-foreground">
            You don’t belong to a team yet. Use the team menu to create one, or
            accept an invitation above.
          </p>
        )}
        <ItemGroup className="gap-1">
          {teams.map((team) => (
            <Item key={team.id} className="px-0">
              <ItemMedia>
                <TeamGlyph team={team} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{team.name}</ItemTitle>
                <ItemDescription>
                  Joined on {formatDate(team.joinedAt)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">{roleLabel(team.role)}</Badge>
                <MoreMenu>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => open(team, "/emails")}>
                      <EyeIcon />
                      View
                    </DropdownMenuItem>
                    {team.role === "admin" ? (
                      <DropdownMenuItem onClick={() => setRenaming(team)}>
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => open(team, SETTINGS_NAV_INDEX)}
                    >
                      <SettingsIcon />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!team.removable}
                      onClick={() => setLeaving(team)}
                    >
                      <LogOutIcon />
                      Leave
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </SettingsCard>
      <TextFieldDialog
        open={renaming !== null}
        onOpenChange={(next) => {
          if (!next) setRenaming(null)
        }}
        title="Rename team"
        description="Everyone on the team sees this name."
        label="Name"
        value={renaming?.name ?? ""}
        validate={(value) => (value ? null : "Enter a name")}
        onSubmit={async (value) => {
          if (renaming) await renameTeam(renaming.id, value)
          toast.add({ type: "success", title: "Team renamed" })
        }}
      />
      <DeleteTeamDialog
        team={leaving}
        leaving
        onClose={() => setLeaving(null)}
      />
    </>
  )
}

function AccountDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive = false,
  closeOnSuccess = true,
  children,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  destructive?: boolean
  closeOnSuccess?: boolean
  children: React.ReactNode
  onSubmit: (form: FormData) => Promise<unknown>
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setError(null)
          onOpenChange(next)
        }
      }}
    >
      {open && (
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              if (pending) return
              const data = new FormData(event.currentTarget)
              setPending(true)
              setError(null)
              try {
                await onSubmit(data)
                if (closeOnSuccess) onOpenChange(false)
              } catch (error) {
                setError(actionError(error))
              } finally {
                setPending(false)
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              {children}
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline" disabled={pending} />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type="submit"
                variant={destructive ? "destructive" : "default"}
                disabled={pending}
              >
                {pending ? "Please wait…" : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}

function AuthenticationCard() {
  const { user, teams, activeTeamId } = useWorkspace()
  const activeTeam = teams.find((team) => team.id === activeTeamId)
  const [connecting, setConnecting] = React.useState(false)
  const [accounts, setAccounts] = React.useState<
    { id: string; providerId: string; createdAt: string | Date }[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [changing, setChanging] = React.useState(false)
  const methods = accounts
    ? [
        ...new Map(
          [...accounts]
            .sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime()
            )
            .map((account) => [account.providerId, account])
        ).values(),
      ]
    : null
  React.useEffect(() => {
    let alive = true
    authClient
      .listAccounts()
      .then((result) => {
        if (!alive) return
        if (result.error)
          setError(result.error.message ?? "Could not load sign-in methods")
        else setAccounts(result.data)
      })
      .catch((error) => {
        if (alive) setError(actionError(error))
      })
    return () => {
      alive = false
    }
  }, [user.id])
  return (
    <>
      <SettingsCard
        title="Authentication"
        description="Manage how you sign in to your account."
        footer={
          activeTeam?.ssoConfigured ? (
            <Button
              disabled={connecting}
              onClick={async () => {
                setConnecting(true)
                try {
                  await authResult(
                    await authClient.signIn.oauth2({
                      providerId: activeTeam.id,
                      callbackURL: "/profile",
                    })
                  )
                } catch (error) {
                  toast.add({ type: "error", title: actionError(error) })
                } finally {
                  setConnecting(false)
                }
              }}
            >
              <Building2Icon data-icon="inline-start" />
              {connecting ? "Connecting…" : "Continue with SSO"}
            </Button>
          ) : activeTeam?.role === "admin" ? (
            <Link href="/settings/sso" className={buttonVariants()}>
              <Building2Icon data-icon="inline-start" />
              Configure SSO
            </Link>
          ) : undefined
        }
      >
        {error && <FieldError>{error}</FieldError>}
        {!accounts && !error && (
          <p className="text-sm text-muted-foreground">
            Loading sign-in methods…
          </p>
        )}
        <ItemGroup className="gap-1">
          {methods?.map((account) => {
            const password = account.providerId === "credential"
            const Icon = password ? MailIcon : Building2Icon
            const label = password
              ? "Email & Password"
              : `${teams.find((team) => team.id === account.providerId)?.name ?? "Team"} SSO`
            return (
              <Item key={account.id} className="px-0">
                <ItemMedia>
                  <Icon className="size-4" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{label}</ItemTitle>
                  <ItemDescription>{user.email}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="text-xs text-muted-foreground">
                    Connected on{" "}
                    {formatDate(new Date(account.createdAt).getTime())}
                  </span>
                  {password && (
                    <MoreMenu>
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => setChanging(true)}>
                          <KeyRoundIcon />
                          Change password
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </MoreMenu>
                  )}
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </SettingsCard>
      <AccountDialog
        open={changing}
        onOpenChange={setChanging}
        title="Change password"
        description="Choose a new password for your account. Other sessions will be signed out."
        submitLabel="Change password"
        onSubmit={async (form) => {
          await authResult(
            await authClient.changePassword({
              currentPassword: String(form.get("currentPassword")),
              newPassword: String(form.get("newPassword")),
              revokeOtherSessions: false,
            })
          )
          await authResult(await authClient.revokeOtherSessions())
          toast.add({ type: "success", title: "Password changed" })
        }}
      >
        <Field>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
      </AccountDialog>
    </>
  )
}

function MfaSetupForm({
  onClose,
  onBusy,
}: {
  onClose: () => void
  onBusy: (busy: boolean) => void
}) {
  const [enrollment, setEnrollment] = React.useState<{
    totpURI: string
    backupCodes: string[]
  } | null>(null)
  const [showKey, setShowKey] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [checking, setChecking] = React.useState(false)
  const secret = enrollment
    ? (new URL(enrollment.totpURI).searchParams.get("secret") ?? "")
    : ""
  return (
    <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (checking) return
          const form = new FormData(event.currentTarget)
          setChecking(true)
          onBusy(true)
          setError(null)
          try {
            if (!enrollment) {
              const result = await authResult(
                await authClient.twoFactor.enable({
                  password: String(form.get("password")),
                })
              )
              if (result) setEnrollment(result)
            } else {
              await authResult(await authClient.twoFactor.verifyTotp({ code }))
              toast.add({
                type: "success",
                title: "Multi-factor authentication enabled",
              })
              onClose()
            }
          } catch (error) {
            setError(actionError(error))
          } finally {
            setChecking(false)
            onBusy(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Setup multi-factor authentication</DialogTitle>
          <DialogDescription>
            {enrollment
              ? "Use an app like 1Password or Google Authenticator to scan the QR code below."
              : "Enter your password to set up your authenticator."}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          {enrollment ? (
            <>
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-xl border border-border bg-white p-3">
                  <QRCodeSVG
                    value={enrollment.totpURI}
                    size={192}
                    title="QR code for your authenticator app"
                  />
                </div>
                <div className="flex flex-col items-center text-sm">
                  <span className="text-muted-foreground">
                    Can&apos;t scan the code?
                  </span>
                  {showKey ? (
                    <MonoValue copyValue={secret}>{secret}</MonoValue>
                  ) : (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => setShowKey(true)}
                    >
                      View the Setup Key
                    </Button>
                  )}
                </div>
              </div>
              <Field>
                <FieldLabel>Backup codes</FieldLabel>
                <CodeWell copyValue={enrollment.backupCodes.join("\n")}>
                  {enrollment.backupCodes.join("\n")}
                </CodeWell>
                <FieldDescription>
                  Save these codes somewhere safe. Each code works once.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mfa-code">
                  Verify the code from the app
                </FieldLabel>
                <InputOTP
                  id="mfa-code"
                  maxLength={6}
                  inputMode="numeric"
                  pattern="^\d*$"
                  value={code}
                  onChange={(next) => {
                    setCode(next)
                    setError(null)
                  }}
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }, (_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </Field>
            </>
          ) : (
            <Field>
              <FieldLabel htmlFor="mfa-password">Password</FieldLabel>
              <Input
                id="mfa-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={checking} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="submit"
            disabled={checking || (!!enrollment && code.length < 6)}
          >
            {checking ? "Please wait…" : enrollment ? "Add" : "Continue"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function MfaCard() {
  const { user } = useWorkspace()
  const [setup, setSetup] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [disabling, setDisabling] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)
  const [codes, setCodes] = React.useState<string[]>([])
  return (
    <>
      <SettingsCard
        title="Multi-factor authentication (MFA)"
        description="Protect your account by adding an extra layer of security."
        actions={
          user.mfa ? (
            <Badge variant="success" dot>
              Enabled
            </Badge>
          ) : undefined
        }
        footer={
          user.mfa ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setCodes([])
                  setRegenerating(true)
                }}
              >
                Regenerate backup codes
              </Button>
              <Button variant="outline" onClick={() => setDisabling(true)}>
                Disable MFA
              </Button>
            </>
          ) : (
            <Button onClick={() => setSetup(true)}>Enable MFA</Button>
          )
        }
      />
      <Dialog
        open={setup}
        onOpenChange={(next) => {
          if (!busy) setSetup(next)
        }}
      >
        {setup && (
          <MfaSetupForm onClose={() => setSetup(false)} onBusy={setBusy} />
        )}
      </Dialog>
      <AccountDialog
        open={disabling}
        onOpenChange={setDisabling}
        title="Disable MFA?"
        description="Your account goes back to signing in without a code from your authenticator app."
        submitLabel="Disable MFA"
        destructive
        onSubmit={async (form) => {
          await authResult(
            await authClient.twoFactor.disable({
              password: String(form.get("password")),
            })
          )
          toast.add({
            type: "success",
            title: "Multi-factor authentication disabled",
          })
        }}
      >
        <Field>
          <FieldLabel htmlFor="disable-mfa-password">Password</FieldLabel>
          <Input
            id="disable-mfa-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
      </AccountDialog>
      <AccountDialog
        open={regenerating}
        onOpenChange={setRegenerating}
        title="Backup codes"
        description={
          codes.length
            ? "Save these codes somewhere safe. Previous backup codes no longer work."
            : "Confirm your password to replace your backup codes."
        }
        submitLabel={codes.length ? "Done" : "Regenerate backup codes"}
        closeOnSuccess={false}
        onSubmit={async (form) => {
          if (codes.length) {
            setRegenerating(false)
            return
          }
          const result = await authResult(
            await authClient.twoFactor.generateBackupCodes({
              password: String(form.get("password")),
            })
          )
          if (result) setCodes(result.backupCodes)
        }}
      >
        {codes.length ? (
          <CodeWell copyValue={codes.join("\n")}>{codes.join("\n")}</CodeWell>
        ) : (
          <Field>
            <FieldLabel htmlFor="backup-password">Password</FieldLabel>
            <Input
              id="backup-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
        )}
      </AccountDialog>
    </>
  )
}

function InvitesCard() {
  const { receivedInvitations } = useWorkspace()
  const respond = useMutation(api.teams.respond)
  const [pending, setPending] = React.useState<string | null>(null)
  async function answer(invitationId: string, accept: boolean) {
    setPending(invitationId)
    try {
      await respond({ invitationId, accept })
      toast.add({
        type: "success",
        title: accept ? "Invitation accepted" : "Invitation declined",
      })
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setPending(null)
    }
  }
  return (
    <SettingsCard title="Invites" flush={receivedInvitations.length > 0}>
      {receivedInvitations.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <Th>Team</Th>
              <Th>Expires</Th>
              <Th className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {receivedInvitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">{invitation.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invitation.expiresAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={pending !== null}
                        onClick={() => answer(invitation.id, true)}
                      >
                        Accept invitation
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={pending !== null}
                        onClick={() => answer(invitation.id, false)}
                      >
                        Reject invitation
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          There are no pending invites.
        </p>
      )}
    </SettingsCard>
  )
}

function DeleteAccountCard() {
  const deleteAccount = useMutation(api.teams.deleteAccount)
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <SettingsCard
        title="Delete account"
        description="Permanently delete your account and teams where you are the only member. Transfer admin access before leaving a shared team."
        footer={
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        }
      />
      <TypeToConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete account"
        description="This action is irreversible. Your account and teams where you are the only member will be permanently deleted. Sign in again if your last sign-in was more than five minutes ago."
        phrase="DELETE"
        confirmLabel="Delete account"
        onConfirm={async () => {
          await deleteAccount({})
          await authResult(await authClient.signOut())
          window.location.assign("/login")
        }}
      />
    </>
  )
}

export function Profile() {
  return (
    <>
      <PageHeader title="Profile" />
      <EmailCard />
      <InvitesCard />
      <TeamsCard />
      <AuthenticationCard />
      <MfaCard />
      <SettingsCard title="OAuth apps" flush>
        <EmptyState
          size="sm"
          icon={BlocksIcon}
          title="No authorized apps"
          description="Third-party apps you authorize to access your account will appear here."
        />
      </SettingsCard>
      <DeleteAccountCard />
    </>
  )
}
