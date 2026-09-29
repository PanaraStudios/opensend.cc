"use client"
import { useAction, useMutation } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  useTeamRole,
  useWorkspace,
  requireTeamId,
} from "@/components/auth/workspace"
import type { ApiKey } from "@/lib/dashboard/types"

type ApiKeyRow = FunctionReturnType<typeof api.apiKeys.list>["page"][number]

export function asApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row._id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    tokenLast4: row.tokenLast4,
    permission: row.permission,
    domainId: row.domainId ?? null,
    createdAt: row._creationTime,
    lastUsedAt: row.lastUsedAt,
    createdBy: row.createdBy.name,
  }
}

type KeyValues = Pick<ApiKey, "name" | "permission" | "domainId">

export function useApiKeyCommands() {
  const workspace = useWorkspace()
  const { canWrite } = useTeamRole()
  const create = useAction(api.apiKeys.create)
  const update = useMutation(api.apiKeys.update)
  const remove = useMutation(api.apiKeys.remove)
  return {
    organizationId: workspace.activeTeamId,
    canWrite,
    /** The token comes back once; only its hash is kept. */
    createApiKey: async (input: KeyValues) => {
      const organizationId = requireTeamId(workspace.activeTeamId)
      return create({ organizationId, input })
    },
    updateApiKey: (id: string, patch: KeyValues) =>
      update({ id: id as Id<"apiKeys">, patch }),
    deleteApiKey: (id: string) => remove({ id: id as Id<"apiKeys"> }),
  }
}
