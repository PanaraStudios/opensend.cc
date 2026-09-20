"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { CheckIcon, XIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { oauthScopes, type OAuthScope } from "@/lib/oauth/policy"
import { authClient, authResult } from "@/lib/auth/client"
import { buttonVariants } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AsyncForm } from "./ui"
import { AccountTeamAccess } from "./workspace"
export function OAuthConsent() {
  const params = useSearchParams(),
    flow = params.get("flow") ?? ""
  const { isAuthenticated, isLoading } = useConvexAuth()
  const account = useQuery(api.teams.snapshot, isAuthenticated ? {} : "skip")
  const [pending, setPending] = useState<{
    name: string
    scopes: string[]
  } | null>(null)
  const [error, setError] = useState("")
  const [teamId, setTeamId] = useState("")
  const [cancelled, setCancelled] = useState(false)
  const [responding, setResponding] = useState(false)
  const returnTo = `/oauth/consent?flow=${flow}`
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/oauth/flow?flow=${encodeURIComponent(flow)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok)
          throw new Error(data.error_description ?? "Authorization unavailable")
        setPending(data)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [flow])
  if (error || params.has("error") || cancelled)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          {cancelled ? "Authorization cancelled" : "Authorization unavailable"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {cancelled
            ? "No access was granted. You can close this page."
            : error ||
              "The request is invalid. Start again from the application."}
        </p>
      </div>
    )
  if (isLoading || !pending || (isAuthenticated && account === undefined))
    return <p role="status">Loading authorization…</p>
  if (!isAuthenticated || !account)
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Connect {pending.name}</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to review this application’s access to your team.
        </p>
        <Link
          className={buttonVariants()}
          href={`/login?next=${encodeURIComponent(returnTo)}`}
        >
          Sign in
        </Link>
      </div>
    )
  if (!account.teams.length) return <AccountTeamAccess account={account} />
  const admins = account.teams.filter((t) => t.role === "admin")
  const teamItems = admins.map((team) => ({ value: team.id, label: team.name }))
  const selected = admins.find((t) => t.id === teamId)
  async function decide(accept: boolean) {
    setResponding(true)
    try {
      const response = await fetch(
        `/oauth/flow?flow=${encodeURIComponent(flow)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accept, organizationId: teamId }),
        }
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error_description ?? result.error ?? "Authorization failed"
        )
      if (result.cancelled) setCancelled(true)
      else if (typeof result.url === "string")
        window.location.assign(result.url)
      else
        throw new Error(
          "Authorization failed. Start again from the application."
        )
    } finally {
      setResponding(false)
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold break-words">
          Connect {pending.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Authorizing as {account.user.email}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        This application was registered by a third party. Authorize it only if
        you trust it.
      </p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="oauth-team">Team</FieldLabel>
          <Select
            items={teamItems}
            value={teamId || null}
            onValueChange={(value) => setTeamId(value ?? "")}
            disabled={responding}
          >
            <SelectTrigger id="oauth-team" className="w-full">
              <SelectValue placeholder="Choose a team" />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              <SelectGroup>
                {teamItems.map((team) => (
                  <SelectItem
                    key={team.value}
                    value={team.value}
                    data-testid={`oauth-team-${team.value}`}
                  >
                    {team.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      {!admins.length && (
        <p role="alert" className="text-sm text-muted-foreground">
          Only team admins can authorize applications.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Requested permissions</p>
        <ul className="list-inside list-disc text-sm">
          {pending.scopes.map((s) => (
            <li key={s}>{oauthScopes[s as OAuthScope]}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Access continues after you sign out. You can disconnect this
          application in Profile at any time.
        </p>
      </div>
      {selected?.ssoRequired ? (
        <AsyncForm
          submitLabel="Continue with SSO"
          fullWidth
          onSubmit={async () => {
            await authResult(
              await authClient.signIn.oauth2({
                providerId: selected.id,
                callbackURL: returnTo,
              })
            )
          }}
        />
      ) : (
        <AsyncForm
          submitLabel="Authorize"
          submitIcon={CheckIcon}
          fullWidth
          success={false}
          disabled={!selected || responding}
          onSubmit={() => decide(true)}
        />
      )}
      <AsyncForm
        submitLabel="Cancel"
        submitVariant="ghost"
        submitIcon={XIcon}
        fullWidth
        success={false}
        disabled={responding}
        onSubmit={() => decide(false)}
      />
    </div>
  )
}
