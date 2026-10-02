"use node"
import { ConvexError, v } from "convex/values"
import { action } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { agentActor } from "./agentAccess"
import {
  gateway,
  callingFailure,
  performCall,
  connectCall,
} from "./callActions"
import { checkPermission } from "./settings"
import { agentQueues } from "../../services/call-gateway/src/queues"
import { permissionAllows } from "../../lib/meta/softphone"
const browserArgs = { organizationId: v.string(), browserId: v.string() }
const recipientArgs = {
  organizationId: v.string(),
  accountId: v.id("channelAccounts"),
  recipient: v.string(),
}
export const session = action({
  args: browserArgs,
  returns: v.object({
    extension: v.string(),
    password: v.string(),
    expiresAt: v.number(),
    wssUrl: v.string(),
    leaseId: v.string(),
    queues: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args
  ): Promise<
    import("../../services/call-gateway/src/agents").AgentCredential & {
      wssUrl: string
      leaseId: string
      queues: string[]
    }
  > => {
    await agentActor(ctx, args.organizationId)
    const wssUrl = process.env.CALL_AGENT_WSS_URL ?? ""
    let validWss = false
    try {
      const url = new URL(wssUrl)
      validWss =
        url.protocol === "wss:" && !url.username && !url.password && !url.hash
    } catch {
      /* Missing/invalid endpoint is a configuration error. */
    }
    if (!validWss)
      throw new ConvexError(
        "Set CALL_AGENT_WSS_URL to your trusted FreeSWITCH WSS endpoint"
      )
    const row: Doc<"callAgents"> = await ctx.runMutation(
      internal.calling.softphoneState.begin,
      args
    )
    try {
      const credential = await gateway().agentSession(row.leaseId)
      await ctx.runMutation(internal.calling.softphoneState.provisioned, {
        ...args,
        leaseId: row.leaseId,
        extension: credential.extension,
        expiresAt: credential.expiresAt,
      })
      return {
        ...credential,
        wssUrl,
        leaseId: row.leaseId,
        queues: agentQueues(process.env.CALL_AGENT_QUEUES, args.organizationId),
      }
    } catch (error) {
      callingFailure(error)
    }
  },
})
export const revoke = action({
  args: browserArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(
      internal.calling.softphoneState.context,
      args
    )
    await ctx.runMutation(internal.calling.softphoneState.setAway, args)
    await gateway().revokeAgent(row.leaseId)
    return null
  },
})
export const answer = action({
  args: { ...browserArgs, id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await ctx.runQuery(internal.calling.softphoneState.owned, args)
    await performCall(ctx, {
      organizationId: args.organizationId,
      id: args.id,
      action: "accept",
      expectedAgentLeaseId: call.agentLeaseId,
      input: {},
    })
    return null
  },
})
export const hangup = action({
  args: { ...browserArgs, id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await ctx.runQuery(internal.calling.softphoneState.owned, {
      ...args,
      online: false,
    })
    await performCall(ctx, {
      organizationId: args.organizationId,
      id: args.id,
      action:
        call.direction === "inbound" && call.status !== "connected"
          ? "reject"
          : "terminate",
      input: {},
    })
    return null
  },
})
export const permission = action({
  args: recipientArgs,
  returns: v.object({
    canCall: v.boolean(),
    canRequest: v.boolean(),
    data: v.any(),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    canCall: boolean
    canRequest: boolean
    data: Record<string, unknown>
  }> => {
    await agentActor(ctx, args.organizationId)
    const data: Record<string, unknown> = await checkPermission(ctx, {
      organizationId: args.organizationId,
      from: args.accountId,
      identity: args.recipient,
      bsuid: true,
    })
    return {
      canCall: permissionAllows(data, "start_call"),
      canRequest: permissionAllows(data, "send_call_permission_request"),
      data,
    }
  },
})
export const outbound = action({
  args: { ...recipientArgs, browserId: v.string() },
  returns: v.id("calls"),
  handler: async (ctx, args): Promise<Id<"calls">> => {
    const agent = await ctx.runQuery(internal.calling.softphoneState.context, {
      organizationId: args.organizationId,
      browserId: args.browserId,
    })
    const data: Record<string, unknown> = await checkPermission(ctx, {
      organizationId: args.organizationId,
      from: args.accountId,
      identity: args.recipient,
      bsuid: true,
    })
    if (!permissionAllows(data, "start_call"))
      throw new ConvexError(
        "Calling permission is required. Request permission first."
      )
    const result = await connectCall(ctx, {
      organizationId: args.organizationId,
      agentPresenceId: agent._id,
      agentLeaseId: agent.leaseId,
      input: {
        from: args.accountId,
        recipient: args.recipient,
        route: "gateway",
      },
    })
    return result.id
  },
})
export const requestPermission = action({
  args: recipientArgs,
  returns: v.id("channelMessages"),
  handler: async (ctx, args): Promise<Id<"channelMessages">> => {
    await agentActor(ctx, args.organizationId)
    const data: Record<string, unknown> = await checkPermission(ctx, {
      organizationId: args.organizationId,
      from: args.accountId,
      identity: args.recipient,
      bsuid: true,
    })
    if (!permissionAllows(data, "send_call_permission_request"))
      throw new ConvexError(
        "Meta does not currently allow another permission request"
      )
    return ctx.runMutation(
      internal.calling.softphoneState.requestPermission,
      args
    )
  },
})
export const control = action({
  args: {
    ...browserArgs,
    id: v.id("calls"),
    operation: v.union(
      v.literal("hold"),
      v.literal("resume"),
      v.literal("transfer")
    ),
    agentId: v.optional(v.id("callAgents")),
    queue: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await ctx.runQuery(internal.calling.softphoneState.owned, {
      organizationId: args.organizationId,
      browserId: args.browserId,
      id: args.id,
    })
    if (call.status !== "connected")
      throw new ConvexError("Call is not connected")
    if (
      args.operation === "transfer" &&
      Number(!!args.agentId) + Number(!!args.queue) !== 1
    )
      throw new ConvexError("Choose an agent or queue")
    const target = args.agentId
      ? await ctx.runMutation(internal.calling.softphoneState.transferTarget, {
          organizationId: args.organizationId,
          browserId: args.browserId,
          id: args.id,
          agentId: args.agentId,
        })
      : null
    if (
      args.queue &&
      !agentQueues(process.env.CALL_AGENT_QUEUES, args.organizationId).includes(
        args.queue
      )
    )
      throw new ConvexError("Queue is not configured")
    try {
      await gateway().control({
        callId: args.id,
        organizationId: args.organizationId,
        operation: args.operation,
        extension: target?.extension,
        queue: args.queue,
      })
      if (args.operation === "transfer")
        await ctx.runMutation(internal.calling.softphoneState.transferred, {
          organizationId: args.organizationId,
          browserId: args.browserId,
          id: args.id,
          leaseId: call.agentLeaseId!,
          targetId: target?._id,
          targetLeaseId: target?.leaseId,
        })
      return null
    } catch (error) {
      callingFailure(error)
    } finally {
      if (target)
        await ctx.runMutation(internal.calling.softphoneState.releaseTransfer, {
          organizationId: args.organizationId,
          browserId: args.browserId,
          id: args.id,
          targetId: target._id,
        })
    }
  },
})
