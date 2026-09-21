"use client"
import { createContext, useContext, useEffect } from "react"
import { useQuery, useMutation, useConvexAuth } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import { authClient, authResult } from "@/lib/auth/client"
import { AsyncForm, FormInput } from "./ui"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { LogOutIcon, SettingsIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { AuthPageFrame } from "./page-frame"
import { FieldGroup } from "@/components/ui/field"
import { InstallationWizard } from "@/components/onboarding/wizard"
import { SES_SETTINGS_PAGE } from "@/lib/dashboard/nav"
export type Workspace = NonNullable<
  FunctionReturnType<typeof api.teams.snapshot>
>
const Context = createContext<Workspace | null>(null)
export function useWorkspace() {
  const value = useContext(Context)
  if (!value) throw new Error("Account data is not available")
  return value
}
export function AccountTeamAccess({ account }: { account: Workspace }) {
  return (
    <Context.Provider value={account}>
      <TeamAccess />
    </Context.Provider>
  )
}
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const data = useQuery(api.teams.snapshot, isAuthenticated ? {} : "skip")
  const installation = useQuery(
    api.installation.status,
    isAuthenticated && data ? {} : "skip"
  )
  const path = usePathname()
  const router = useRouter()
  const setupPending = !!installation && !installation.installation?.completedAt
  useEffect(() => {
    if (
      isAuthenticated &&
      setupPending &&
      (path === "/profile" ||
        path.startsWith("/settings") ||
        path === SES_SETTINGS_PAGE.href)
    )
      router.replace("/emails")
  }, [isAuthenticated, setupPending, path, router])
  if (
    isLoading ||
    (isAuthenticated &&
      (data === undefined || (data && installation === undefined)))
  )
    return (
      <p className="p-10" role="status">
        Loading your account…
      </p>
    )
  if (!isAuthenticated || data === null)
    return (
      <p className="p-10">
        <Link href="/login">Sign in to continue</Link>
      </p>
    )
  if (!data) return null
  const active = data.teams.find((t) => t.id === data.activeTeamId)
  return (
    <Context.Provider value={data}>
      {setupPending &&
      !(
        installation.admin &&
        installation.installation?.setupStep === "domain" &&
        (path === "/domains" || path.startsWith("/domains/"))
      ) ? (
        <AuthPageFrame wide>
          {installation.admin ? (
            <InstallationWizard />
          ) : (
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold">Setup is in progress</h1>
              <p className="text-sm text-muted-foreground">
                Your installation administrator needs to finish setup before you
                can use Opensend.
              </p>
            </div>
          )}
        </AuthPageFrame>
      ) : path !== "/profile" &&
        path !== SES_SETTINGS_PAGE.href &&
        path !== "/settings/ses" &&
        (!active || active.ssoRequired) ? (
        <AuthPageFrame>
          <div className="flex flex-col gap-6">
            <TeamAccess />
          </div>
        </AuthPageFrame>
      ) : (
        children
      )}
    </Context.Provider>
  )
}
export function TeamAccess({ onboarding = false }: { onboarding?: boolean }) {
  const data = useWorkspace()
  const respond = useMutation(api.teams.respond)
  const active = data.teams.find((t) => t.id === data.activeTeamId)
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {active?.ssoRequired
          ? `Sign in to ${active.name}`
          : active
            ? "Invitations and new teams"
            : "Create or join a team"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {active?.ssoRequired
          ? "Use your team’s identity provider to continue."
          : "Create a team for your project, or accept an invitation below."}
      </p>
      {active?.ssoRequired && (
        <AsyncForm
          submitLabel="Continue with SSO"
          fullWidth
          onSubmit={async () => {
            await authResult(
              await authClient.signIn.oauth2({
                providerId: active.id,
                callbackURL: "/emails",
              })
            )
          }}
        />
      )}
      {!active?.ssoRequired && <CreateTeamForm />}
      {data.receivedInvitations.map((i) => (
        <div key={i.id} className="flex flex-col gap-3 rounded-lg border p-4">
          <p>Invitation to {i.name}</p>
          <AsyncForm
            submitLabel="Accept invitation"
            onSubmit={async () => {
              await respond({ invitationId: i.id, accept: true })
            }}
          />
          <AsyncForm
            submitLabel="Reject invitation"
            submitVariant="ghost"
            onSubmit={async () => {
              await respond({ invitationId: i.id, accept: false })
            }}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-start justify-between gap-2">
        {!onboarding && (
          <Link
            href="/profile"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <SettingsIcon data-icon="inline-start" />
            Account settings
          </Link>
        )}
        <AsyncForm
          submitLabel="Log out"
          submitVariant="ghost"
          submitIcon={LogOutIcon}
          success={false}
          onSubmit={async () => {
            await authResult(await authClient.signOut())
            window.location.assign("/login")
          }}
        />
      </div>
    </>
  )
}

export function CreateTeamForm({
  onCreated,
}: {
  onCreated?: () => Promise<unknown>
}) {
  const create = useMutation(api.teams.create)
  return (
    <AsyncForm
      submitLabel="Create team"
      fullWidth
      success={false}
      onSubmit={async (form) => {
        await create({ name: String(form.get("name")) })
        await onCreated?.()
      }}
    >
      <FieldGroup>
        <FormInput
          name="name"
          label="Team name"
          placeholder="Acme"
          autoComplete="organization"
          maxLength={100}
        />
      </FieldGroup>
    </AsyncForm>
  )
}
