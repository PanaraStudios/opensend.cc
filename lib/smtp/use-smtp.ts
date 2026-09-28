"use client"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useWorkspace } from "@/components/auth/workspace"

export function useSmtp() {
  const { activeTeamId } = useWorkspace()
  const smtp = useQuery(
    api.smtp.settings,
    activeTeamId ? { organizationId: activeTeamId } : "skip"
  )
  const update = useMutation(api.smtp.update)
  return {
    smtp,
    updateSmtp: (patch: { enabled?: boolean; port?: 465 | 587 }) => {
      if (!activeTeamId) throw new Error("Create a team first")
      return update({ organizationId: activeTeamId, ...patch })
    },
  }
}
