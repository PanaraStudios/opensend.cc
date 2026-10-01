"use client"
import * as React from "react"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
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

export type ConnectedPageAccounts = FunctionReturnType<
  typeof api.meta.pageConnectActions.connectPageManual
>

export function useChannelCommands() {
  const [syncing, setSyncing] = React.useState<string | null>(null)
  const workspace = useWorkspace()
  const { canWrite } = useTeamRole()
  const manual = useAction(api.meta.connectActions.connectManual)
  const exchange = useAction(api.meta.connectActions.exchangeEmbeddedSignup)
  const pageManual = useAction(api.meta.pageConnectActions.connectPageManual)
  const facebookLogin = useAction(
    api.meta.pageConnectActions.connectFacebookLogin
  )
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
    connectPageManual: (input: { pageId: string; token: string }) =>
      pageManual({ ...input, organizationId: organizationId() }),
    connectFacebookLogin: (code: string) =>
      facebookLogin({ code, organizationId: organizationId() }),
    registerNumber: (accountId: string, pin: string) =>
      register({ accountId: accountId as Id<"channelAccounts">, pin }),
    syncing,
    syncAccount: async (account: Pick<ChannelAccount, "_id" | "channel">) => {
      if (syncing) return
      setSyncing(account._id)
      try {
        await sync({ accountId: account._id })
        toast.add({
          type: "success",
          title:
            account.channel === "whatsapp" ? "Number synced" : "Account synced",
        })
      } catch (error) {
        toast.add({ type: "error", title: actionError(error) })
      } finally {
        setSyncing(null)
      }
    },
    disconnectBusiness: (connectionId: string) =>
      disconnect({ connectionId: connectionId as Id<"metaConnections"> }),
  }
}

/** The installation's Meta app as a team sees it: public IDs only. */
export const useMetaPublicConfig = () => useTeamQuery(api.meta.app.publicConfig)

export function useChannelAccount(id: string | null | undefined) {
  return useQuery(api.meta.connect.getAccount, id ? { id } : "skip")
}
