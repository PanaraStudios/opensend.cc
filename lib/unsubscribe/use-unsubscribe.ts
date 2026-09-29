"use client"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  useWorkspace,
  requireTeamId,
  useTeamQuery,
} from "@/components/auth/workspace"
import type { UnsubscribePage } from "@/lib/unsubscribe/page"

/** The team's unsubscribe page, or undefined while loading. */
export function useUnsubscribePage() {
  return useTeamQuery(api.unsubscribe.page, {})
}

export function useUnsubscribeCommands() {
  const { activeTeamId } = useWorkspace()
  const save = useMutation(api.unsubscribe.savePage)
  return {
    savePage: (page: UnsubscribePage) => {
      const organizationId = requireTeamId(activeTeamId)
      return save({ organizationId, ...page })
    },
  }
}
