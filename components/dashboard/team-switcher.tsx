"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
} from "lucide-react"

import { LogoMark } from "@/components/logo"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar"
import { toast } from "@/components/ui/toast"
import { SEED_TEAM_ID, slugifyTeamName } from "@/lib/dashboard/teams"
import { teamSafePath } from "@/lib/dashboard/nav"
import { useDashboard } from "@/lib/dashboard/store"
import type { Team } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

function teamInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0]!.toUpperCase() : "?"
}

function TeamGlyph({ team, className }: { team: Team; className?: string }) {
  if (team.id === SEED_TEAM_ID) {
    return (
      <span className={cn("icon-tile size-7 rounded-lg", className)}>
        <LogoMark className="size-4" />
      </span>
    )
  }

  return (
    <span
      className={cn(
        "icon-tile size-7 rounded-lg text-xs font-semibold",
        className
      )}
    >
      {teamInitial(team.name)}
    </span>
  )
}

function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { createTeam } = useDashboard()
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const slugPreview = slugifyTeamName(name) || "team"

  function reset() {
    setName("")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter a team name")
      return
    }
    createTeam(name)
    toast.add({ type: "success", title: "Team created" })
    reset()
    onOpenChange(false)
    const next = teamSafePath(pathname)
    if (next !== pathname) router.push(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
            <DialogDescription>
              Teams isolate emails, audiences, domains, and API keys. Invite
              people later from Team settings.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="create-team-name">Team name</FieldLabel>
              <Input
                id="create-team-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
                placeholder="Acme"
                autoFocus
              />
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <FieldDescription>Slug: {slugPreview}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create team</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TeamSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const { isMobile } = useSidebar()
  const { teams, activeTeamId, switchTeam, resetDemo } = useDashboard()
  const [createOpen, setCreateOpen] = React.useState(false)
  const active = teams.find((team) => team.id === activeTeamId) ??
    teams[0] ?? {
      id: SEED_TEAM_ID,
      name: "Opensend",
      slug: "opensend",
    }

  function selectTeam(id: string) {
    if (id === activeTeamId) return
    switchTeam(id)
    const next = teamSafePath(pathname)
    if (next !== pathname) router.push(next)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="h-10 data-open:bg-sidebar-accent"
            />
          }
        >
          <TeamGlyph team={active} />
          <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{active.name}</span>
            <span className="truncate font-mono text-caption text-muted-foreground">
              {active.slug}
            </span>
          </span>
          <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={isMobile ? "bottom" : "right"}
          sideOffset={8}
          className="w-64"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Teams</DropdownMenuLabel>
            {teams.map((team) => {
              const current = team.id === activeTeamId
              return (
                <DropdownMenuItem
                  key={team.id}
                  onClick={() => selectTeam(team.id)}
                >
                  <TeamGlyph team={team} className="size-6 text-[10px]" />
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate">{team.name}</span>
                    <span className="truncate font-mono text-caption text-muted-foreground">
                      {team.slug}
                    </span>
                  </span>
                  <CheckIcon
                    className={cn(
                      "ml-auto size-4",
                      current ? "opacity-100" : "opacity-0"
                    )}
                  />
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create team
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}>
              <SettingsIcon />
              Team settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={resetDemo}>
              <RotateCcwIcon />
              Reset demo data
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
