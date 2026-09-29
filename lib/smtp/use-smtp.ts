"use client"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  useWorkspace,
  requireTeamId,
  useTeamQuery,
} from "@/components/auth/workspace"

export function useSmtp() {
  const { activeTeamId } = useWorkspace()
  const smtp = useTeamQuery(api.smtp.settings)
  const update = useMutation(api.smtp.update)
  return {
    smtp,
    updateSmtp: (patch: { enabled?: boolean; port?: 465 | 587 }) => {
      const organizationId = requireTeamId(activeTeamId)
      return update({ organizationId, ...patch })
    },
  }
}
