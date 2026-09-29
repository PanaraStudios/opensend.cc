"use client"
import * as React from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import {
  useWorkspace,
  requireTeamId,
  useTeamQuery,
} from "@/components/auth/workspace"
import type { AutomationEvent } from "@/lib/dashboard/types"

export function asAutomationEvent(
  row: Doc<"automationEvents">
): AutomationEvent {
  return {
    id: row._id,
    name: row.name,
    schema: row.schema,
    createdAt: row._creationTime,
  }
}

export function useAutomationEventCommands() {
  const { activeTeamId } = useWorkspace()
  const create = useMutation(api.automationEvents.create)
  const update = useMutation(api.automationEvents.update)
  const remove = useMutation(api.automationEvents.remove)
  return {
    organizationId: activeTeamId,
    /** Adds an event, or saves the one `id` names. */
    saveAutomationEvent: async (
      input: Pick<AutomationEvent, "name" | "schema"> & { id?: string }
    ) => {
      const { id, ...fields } = input
      if (id) return update({ id: id as Id<"automationEvents">, ...fields })
      const organizationId = requireTeamId(activeTeamId)
      await create({ ...fields, organizationId })
    },
    deleteAutomationEvent: (id: string) =>
      remove({ id: id as Id<"automationEvents"> }),
  }
}

/** The team's event of that name: undefined while it loads or when there is
    none. */
export function useAutomationEvent(name: string): AutomationEvent | undefined {
  const row = useTeamQuery(
    api.automationEvents.byName,
    { name },
    { enabled: !!name.trim() }
  )
  return React.useMemo(() => (row ? asAutomationEvent(row) : undefined), [row])
}
