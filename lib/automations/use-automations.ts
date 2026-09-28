"use client"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import type {
  Automation,
  AutomationRun,
  AutomationRunStep,
} from "@/lib/dashboard/types"

export function asAutomation(row: Doc<"automations">): Automation {
  return {
    id: row._id,
    name: row.name,
    status: row.status,
    trigger: row.trigger,
    steps: JSON.parse(row.graph),
    createdAt: row._creationTime,
  }
}
export const asListedAutomation = (
  row: Doc<"automations"> & { runs: number }
) => ({ ...asAutomation(row), runs: row.runs })
export function asRun(row: Doc<"automationRuns">): AutomationRun {
  return {
    id: row._id,
    automationId: row.automationId,
    status: row.status,
    contactEmail: row.contactEmail,
    payload: row.payload,
    startedAt: row._creationTime,
    completedAt: row.completedAt ?? null,
    steps: [],
  }
}
export function asRunStep(row: Doc<"automationRunSteps">): AutomationRunStep {
  return {
    key: row.key,
    type: row.type,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    output: row.output ?? null,
    error: row.error ?? null,
  }
}
export function useAutomation(id: string) {
  const { activeTeamId } = useWorkspace()
  const row = useQuery(
    api.automations.get,
    activeTeamId ? { organizationId: activeTeamId, id } : "skip"
  )
  return row === undefined ? undefined : row ? asAutomation(row) : null
}
export function useAutomationCommands() {
  const { activeTeamId } = useWorkspace()
  const create = useMutation(api.automations.create)
  const update = useMutation(api.automations.update)
  const status = useMutation(api.automations.setStatus)
  const duplicate = useMutation(api.automations.duplicate)
  const remove = useMutation(api.automations.remove)
  const test = useMutation(api.automations.test)
  const cancel = useMutation(api.automations.cancelRun)
  const organizationId = activeTeamId ?? ""
  const scope = (id: string) => ({
    organizationId,
    id: id as Id<"automations">,
  })
  return {
    organizationId,
    addAutomation: async () => ({ id: await create({ organizationId }) }),
    updateAutomation: (
      id: string,
      patch: Partial<Pick<Automation, "name" | "trigger" | "steps">>
    ) => {
      const { steps, ...fields } = patch
      return update({
        ...scope(id),
        ...fields,
        ...(steps ? { graph: JSON.stringify(steps) } : {}),
      })
    },
    setAutomationStatus: (id: string, value: Automation["status"]) =>
      status({ ...scope(id), status: value }),
    duplicateAutomation: async (id: string) => ({
      id: await duplicate(scope(id)),
    }),
    deleteAutomation: (id: string) => remove(scope(id)),
    runAutomation: (
      id: string,
      contactId: string,
      payload: Record<string, unknown>
    ) =>
      test({ ...scope(id), contactId: contactId as Id<"contacts">, payload }),
    cancelAutomationRun: (id: string) =>
      cancel({ organizationId, runId: id as Id<"automationRuns"> }),
  }
}
