"use client"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useWorkspace } from "@/components/auth/workspace"
import type { UnsubscribePage } from "@/lib/unsubscribe/page"

/** The team's unsubscribe page, or undefined while loading. */
export function useUnsubscribePage() {
  const { activeTeamId } = useWorkspace()
  return useQuery(
    api.unsubscribe.page,
    activeTeamId ? { organizationId: activeTeamId } : "skip"
  )
}

export function useUnsubscribeCommands() {
  const { activeTeamId } = useWorkspace()
  const save = useMutation(api.unsubscribe.savePage)
  return {
    savePage: (page: UnsubscribePage) => {
      if (!activeTeamId) throw new Error("Create a team first")
      return save({ organizationId: activeTeamId, ...page })
    },
  }
}
