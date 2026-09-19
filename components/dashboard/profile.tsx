"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import {
  BlocksIcon,
  EyeIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  PencilIcon,
  SettingsIcon,
  UnlinkIcon,
} from "lucide-react"

import { GitHubIcon, GoogleIcon } from "@/components/brand-icons"
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
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
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
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  EmptyState,
  MonoValue,
  MoreMenu,
  PageHeader,
  SettingsCard,
  TextFieldDialog,
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
import { createTotpSecret, totpUri, verifyTotp } from "@/lib/dashboard/totp"
import type { AuthProvider, Team } from "@/lib/dashboard/types"

const PROVIDERS: Record<
  AuthProvider,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  password: { label: "Email & Password", icon: MailIcon },
  github: { label: "GitHub", icon: GitHubIcon },
  google: { label: "Google", icon: GoogleIcon },
}

const LINKABLE = ["github", "google"] as const

function EmailCard() {
  const { you, updateEmail } = useDashboard()
  const stored = you?.email ?? ""
  const { draft: email, setDraft: setEmail } = useDraftValue(
    stored,
    updateEmail
  )
  const [error, setError] = React.useState<string | null>(null)
  const next = normalizeEmail(email)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!isEmail(next)) {
          setError("Enter a valid email address")
          return
        }
        if (!updateEmail(next)) {
          setError("Someone on one of your teams already uses that address")
          return
        }
        toast.add({ type: "success", title: "Email updated" })
      }}
    >
      <SettingsCard
        title="Your email"
        footer={
          <Button type="submit" disabled={next === stored}>
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

  const open = (team: Team, href: string) => {
    switchTeam(team.id)
    router.push(href)
  }

  return (
    <>
      <SettingsCard
        title="Teams"
        description="The teams that are associated with your account."
      >
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
        onSubmit={(value) => {
          if (renaming) renameTeam(renaming.id, value)
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

function AuthenticationCard() {
  const { account, you, linkProvider, unlinkProvider } = useDashboard()
  const email = you?.email
  const unlinked = LINKABLE.filter(
    (provider) => !account.providers.some((item) => item.provider === provider)
  )

  return (
    <SettingsCard
      title="Authentication"
      description="Link your account to third-party authentication providers."
      footer={
        unlinked.length > 0
          ? unlinked.map((provider) => (
              <Button
                key={provider}
                onClick={() => {
                  linkProvider(provider)
                  toast.add({
                    type: "success",
                    title: `${PROVIDERS[provider].label} linked`,
                  })
                }}
              >
                Link {PROVIDERS[provider].label}
              </Button>
            ))
          : null
      }
    >
      <ItemGroup className="gap-1">
        {account.providers.map(({ provider, connectedAt }) => {
          const { label, icon: Icon } = PROVIDERS[provider]
          return (
            <Item key={provider} className="px-0">
              <ItemMedia>
                <Icon className="size-4" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{label}</ItemTitle>
                <ItemDescription>{email}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <span className="text-xs text-muted-foreground">
                  Connected on {formatDate(connectedAt)}
                </span>
                <MoreMenu>
                  <DropdownMenuGroup>
                    {provider === "password" ? (
                      <DropdownMenuItem
                        render={<Link href="/forgot-password" />}
                      >
                        <KeyRoundIcon />
                        Change password
                      </DropdownMenuItem>
                    ) : null}
                    {/* The last way in stays. */}
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={account.providers.length < 2}
                      onClick={() => {
                        unlinkProvider(provider)
                        toast.add({
                          type: "success",
                          title: `${label} unlinked`,
                        })
                      }}
                    >
                      <UnlinkIcon />
                      Unlink
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    </SettingsCard>
  )
}

function MfaSetupForm({ onClose }: { onClose: () => void }) {
  const { you, setMfa } = useDashboard()
  const email = you?.email ?? "you"
  const [secret] = React.useState(() => createTotpSecret())
  const [showKey, setShowKey] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [checking, setChecking] = React.useState(false)
  /* Checking takes a moment, in which the dialog may be closed: a setup that
     was walked away from must not switch MFA on. */
  const open = React.useRef(true)
  React.useEffect(() => {
    open.current = true
    return () => {
      open.current = false
    }
  }, [])

  return (
    <DialogContent className="sm:max-w-md">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (checking) return
          setChecking(true)
          const valid = await verifyTotp(secret, code, Date.now())
          if (!open.current) return
          setChecking(false)
          if (!valid) {
            setError("That code is not right. Enter the one the app shows now.")
            return
          }
          setMfa(secret)
          toast.add({
            type: "success",
            title: "Multi-factor authentication enabled",
          })
          onClose()
        }}
      >
        <DialogHeader>
          <DialogTitle>Setup multi-factor authentication</DialogTitle>
          <DialogDescription>
            Use an app like 1Password or Google Authenticator to scan the QR
            code below.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <div className="flex flex-col items-center gap-3">
            {/* A QR code is read dark on light, whatever the theme. */}
            <div className="rounded-xl border border-border bg-white p-3">
              <QRCodeSVG
                value={totpUri(secret, email, "Opensend")}
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
              autoFocus
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={code.length < 6 || checking}>
            Add
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function MfaCard() {
  const { account, setMfa } = useDashboard()
  const [setup, setSetup] = React.useState(false)
  const [disabling, setDisabling] = React.useState(false)

  return (
    <>
      <SettingsCard
        title="Multi-factor authentication (MFA)"
        description="Protect your account by adding an extra layer of security."
        actions={
          account.mfa ? (
            <Badge variant="success" dot>
              Enabled on {formatDate(account.mfa.enabledAt)}
            </Badge>
          ) : null
        }
        footer={
          account.mfa ? (
            <Button variant="outline" onClick={() => setDisabling(true)}>
              Disable MFA
            </Button>
          ) : (
            <Button onClick={() => setSetup(true)}>Enable MFA</Button>
          )
        }
      />
      <Dialog open={setup} onOpenChange={setSetup}>
        {/* Mounted per opening: each setup gets a secret of its own. */}
        {setup ? <MfaSetupForm onClose={() => setSetup(false)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={disabling}
        onOpenChange={setDisabling}
        title="Disable MFA?"
        description="Your account goes back to signing in without a code from your authenticator app."
        confirmLabel="Disable MFA"
        onConfirm={() => {
          setMfa(null)
          toast.add({
            type: "success",
            title: "Multi-factor authentication disabled",
          })
        }}
      />
    </>
  )
}

function DeleteAccountCard() {
  const router = useRouter()
  const { activeTeam, resetDemo } = useDashboard()
  const [open, setOpen] = React.useState(false)
  /* Teams go first. The last one cannot go by itself, so it goes with the
     account. */
  const blocking = activeTeam.removable ? activeTeam : null

  return (
    <>
      <SettingsCard
        title="Delete account"
        description={
          blocking ? (
            <>
              Accounts can only be deleted when there are no more teams still
              associated with it. Start by deleting your active team,{" "}
              <span className="font-medium text-foreground">
                {blocking.name}
              </span>
              . Once it is deleted, you can delete your user account.
            </>
          ) : (
            "Permanently delete your account, your last team, and all of its contents from Opensend."
          )
        }
        footer={
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        }
      />
      {blocking ? (
        <DeleteTeamDialog
          team={open ? blocking : null}
          onClose={() => setOpen(false)}
        />
      ) : (
        <TypeToConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete account"
          description="This action is irreversible. Your account and everything in your last team will be permanently deleted."
          phrase="DELETE"
          confirmLabel="Delete account"
          onConfirm={() => {
            resetDemo()
            router.push("/waitlist")
          }}
        />
      )}
    </>
  )
}

export function Profile() {
  return (
    <>
      <PageHeader title="Profile" />
      <EmailCard />
      <SettingsCard title="Invites">
        <p className="text-sm text-muted-foreground">
          There are no pending invites.
        </p>
      </SettingsCard>
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
