"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import { LogoMark } from "@/components/logo"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  RadioCards,
  TypeToConfirmDialog,
} from "@/components/dashboard/primitives"
import { isEmail, pluralize } from "@/lib/dashboard/format"
import { teamSafePath } from "@/lib/dashboard/nav"
import { useDashboard } from "@/lib/dashboard/store"
import { SEED_TEAM_ID } from "@/lib/dashboard/teams"
import type { MemberRole, Team } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

const ROLE_OPTIONS = [
  {
    value: "admin",
    label: "Admin",
    description: "Invite users, update payment, and delete the team.",
  },
  {
    value: "member",
    label: "Member",
    description: "Manage emails, domains, and webhooks.",
  },
] as const

/** A team's mark: its uploaded image, else our logo for the seeded team and
    the first letter of the name for any other. */
export function TeamGlyph({
  team,
  className,
}: {
  team: Pick<Team, "id" | "name" | "avatar">
  className?: string
}) {
  const name = team.name.trim()
  return (
    <span
      className={cn(
        "icon-tile size-7 overflow-hidden rounded-lg text-xs font-semibold",
        className
      )}
    >
      {team.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL
        <img src={team.avatar} alt="" className="size-full object-cover" />
      ) : team.id === SEED_TEAM_ID ? (
        <LogoMark className="size-[57%]" />
      ) : (
        (name[0]?.toUpperCase() ?? "?")
      )}
    </span>
  )
}

export function InviteMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted per opening, so the form starts empty. */}
      {open ? <InviteMemberForm onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

function InviteMemberForm({ onClose }: { onClose: () => void }) {
  const { state, inviteMember } = useDashboard()
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<MemberRole>("member")
  const [error, setError] = React.useState<string | null>(null)

  return (
    <DialogContent className="sm:max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const address = email.trim().toLowerCase()
          if (!isEmail(address)) {
            setError("Enter a valid email address")
            return
          }
          if (state.members.some((member) => member.email === address)) {
            setError("That person is already on the team")
            return
          }
          inviteMember({ email: address, role })
          toast.add({ type: "success", title: "Invite sent" })
          onClose()
        }}
      >
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              value={email}
              placeholder="ada.lovelace@example.com"
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
              }}
              autoFocus
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>Select role</FieldLabel>
            <RadioCards
              aria-label="Role"
              value={role}
              onChange={setRole}
              options={ROLE_OPTIONS}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit">Invite</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** Deletes a team, or leaves it. Leaving a team you share only takes you out
    of it; leaving one you are alone in deletes it, as there is nobody left to
    own it. Either way this browser stops holding the workspace. */
export function DeleteTeamDialog({
  team,
  leaving = false,
  open,
  onOpenChange,
}: {
  team: Team
  /** Asked to leave rather than to delete. */
  leaving?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { state, activeTeamId, deleteTeam } = useDashboard()
  const active = team.id === activeTeamId

  const remove = (title: string) => {
    deleteTeam(team.id)
    toast.add({ type: "success", title })
    /* The page may be about a record of the team that just went. */
    if (active) router.push(teamSafePath(pathname))
  }

  if (leaving && team.members > 1) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Leave team?"
        description={`You lose access to ${team.name}. An admin has to invite you back.`}
        confirmLabel="Leave team"
        onConfirm={() => remove("You left the team")}
      />
    )
  }

  if (leaving) {
    return (
      <TypeToConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Delete team"
        description={`You are the only member of ${team.name}. Leaving will permanently delete this team and all its data. This action is irreversible.`}
        phrase="DELETE"
        confirmLabel="Delete team"
        onConfirm={() => remove("Team deleted")}
      />
    )
  }

  return (
    <TypeToConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete team"
      description="This action is irreversible. All team data will be permanently deleted."
      phrase={team.name}
      acknowledgement="I understand all team data will be permanently deleted and the team will stop sending and receiving emails."
      confirmLabel="Delete team"
      onConfirm={() => remove("Team deleted")}
    >
      {/* Only the open team's contents are at hand. */}
      {active && state.domains.length + state.apiKeys.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
          {state.domains.length > 0 ? (
            <li>
              <span className="font-medium">
                {pluralize(state.domains.length, "domain")}
              </span>
              <span className="block truncate text-muted-foreground">
                {state.domains.map((domain) => domain.name).join(", ")}
              </span>
            </li>
          ) : null}
          {state.apiKeys.length > 0 ? (
            <li className="font-medium">
              {pluralize(state.apiKeys.length, "API key")}
            </li>
          ) : null}
        </ul>
      ) : null}
    </TypeToConfirmDialog>
  )
}
