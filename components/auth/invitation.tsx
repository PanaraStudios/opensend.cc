"use client"
import { useState } from "react"
import Link from "next/link"
import { ArrowRightIcon, CheckIcon, UserPlusIcon, XIcon } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { buttonVariants } from "@/components/ui/button"
import { AsyncForm } from "./ui"
export function Invitation() {
  const params = useSearchParams()
  const router = useRouter()
  const id = params.get("id") ?? ""
  const { isAuthenticated, isLoading } = useConvexAuth()
  const data = useQuery(api.teams.snapshot, isAuthenticated ? {} : "skip")
  const respond = useMutation(api.teams.respond)
  const [responding, setResponding] = useState(false)
  const next = encodeURIComponent(`/invitation?id=${encodeURIComponent(id)}`)
  async function respondToInvitation(accept: boolean) {
    setResponding(true)
    try {
      await respond({ invitationId: id, accept })
      router.push(accept ? "/emails" : "/profile")
    } finally {
      setResponding(false)
    }
  }
  if (isLoading || (isAuthenticated && data === undefined))
    return <p role="status">Loading invitation…</p>
  if (!isAuthenticated || !data)
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Join your team</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with the invited email address, or create and verify your
            account.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Link href={`/login?next=${next}`} className={buttonVariants()}>
            Sign in
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
          <Link
            href={`/signup?next=${next}`}
            className={buttonVariants({ variant: "outline" })}
          >
            <UserPlusIcon data-icon="inline-start" />
            Create account
          </Link>
        </div>
      </div>
    )
  const invitation = data.receivedInvitations.find((i) => i.id === id)
  if (!invitation)
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This invitation has expired, has already been handled, or belongs to
            a different email address.
          </p>
        </div>
        <Link
          href="/profile"
          className={buttonVariants({ variant: "outline" })}
        >
          Account settings
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
      </div>
    )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold break-words">
          Join {invitation.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          You’ve been invited to join this team.
        </p>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">Joining as</p>
        <p className="font-medium break-all">{data.user.email}</p>
      </div>
      <div className="flex flex-col gap-2">
        <AsyncForm
          submitLabel="Accept invitation"
          submitIcon={CheckIcon}
          fullWidth
          success={false}
          disabled={responding}
          onSubmit={() => respondToInvitation(true)}
        />
        <AsyncForm
          submitLabel="Reject invitation"
          submitVariant="ghost"
          submitIcon={XIcon}
          fullWidth
          success={false}
          disabled={responding}
          onSubmit={() => respondToInvitation(false)}
        />
      </div>
    </div>
  )
}
