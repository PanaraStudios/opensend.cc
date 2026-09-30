"use client"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  requireTeamId,
  useTeamQuery,
  useTeamRole,
  useWorkspace,
} from "@/components/auth/workspace"

/** A connected sending endpoint, as the Channels list shows it. */
export type ChannelAccount = FunctionReturnType<
  typeof api.meta.connect.listAccounts
>["page"][number]
export type ChannelAccountDetail = NonNullable<
  FunctionReturnType<typeof api.meta.connect.getAccount>
>
/** What connecting returns: the numbers the WABA brought. */
export type ConnectedBusiness = FunctionReturnType<
  typeof api.meta.connectActions.connectManual
>

export function useChannelCommands() {
  const workspace = useWorkspace()
  const { canWrite } = useTeamRole()
  const manual = useAction(api.meta.connectActions.connectManual)
  const exchange = useAction(api.meta.connectActions.exchangeEmbeddedSignup)
  const register = useAction(api.meta.connectActions.registerNumber)
  const sync = useAction(api.meta.connectActions.syncAccount)
  const disconnect = useMutation(api.meta.connect.disconnect)
  const organizationId = () => requireTeamId(workspace.activeTeamId)
  return {
    organizationId: workspace.activeTeamId,
    canWrite,
    connectManual: (input: { wabaId: string; token: string }) =>
      manual({ ...input, organizationId: organizationId() }),
    /** Finishes Embedded Signup; the code expires 30 seconds after Meta
        issues it. */
    exchangeSignup: (input: {
      code: string
      wabaId: string
      businessId: string
      phoneNumberId?: string
    }) => exchange({ ...input, organizationId: organizationId() }),
    registerNumber: (accountId: string, pin: string) =>
      register({ accountId: accountId as Id<"channelAccounts">, pin }),
    syncAccount: (accountId: string) =>
      sync({ accountId: accountId as Id<"channelAccounts"> }),
    disconnectBusiness: (connectionId: string) =>
      disconnect({ connectionId: connectionId as Id<"metaConnections"> }),
  }
}

/** The installation's Meta app as a team sees it: public IDs only. */
export const useMetaPublicConfig = () => useTeamQuery(api.meta.app.publicConfig)

export function useChannelAccount(id: string | null | undefined) {
  return useQuery(api.meta.connect.getAccount, id ? { id } : "skip")
}
