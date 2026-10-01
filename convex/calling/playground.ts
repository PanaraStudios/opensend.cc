"use node"
import { ConvexError, v } from "convex/values"
import { action, internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { agentActor } from "./agentAccess"
import { gateway } from "./callActions"
export const start = action({
  args: {
    organizationId: v.string(),
    browserId: v.string(),
    accountId: v.id("channelAccounts"),
    ivrId: v.id("ivrs"),
    contactId: v.optional(v.id("contacts")),
  },
  returns: v.id("calls"),
  handler: async (
    ctx,
    args
  ): Promise<import("../_generated/dataModel").Id<"calls">> => {
    const call = await ctx.runMutation(
      internal.calling.playgroundState.create,
      args
    )
    try {
      await gateway().playground({
        callId: call._id,
        extension: call.agentExtension!,
      })
      await gateway().route({
        callId: call._id,
        target: "ivr",
        ivrId: args.ivrId,
        organizationId: args.organizationId,
        maxDurationSeconds: 300,
      })
      await ctx.runMutation(internal.calling.rows.finish, {
        id: call._id,
        status: "connected",
        routed: true,
      })
      return call._id
    } catch (e) {
      await gateway()
        .hangup(call._id)
        .catch(() => undefined)
      await ctx.runMutation(internal.calling.rows.finish, {
        id: call._id,
        status: "failed",
        error:
          "Test call could not connect. Check the calling profile, trusted WSS and TURN configuration.",
      })
      void e
      throw new ConvexError(
        "Test call could not connect. Check the calling profile, trusted WSS and TURN configuration."
      )
    }
  },
})
export const hangup = action({
  args: {
    organizationId: v.string(),
    browserId: v.string(),
    id: v.id("calls"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.calling.playgroundState.owned, args)
    await gateway().hangup(args.id)
    await ctx.runMutation(internal.calling.rows.finish, {
      id: args.id,
      status: "completed",
    })
    return null
  },
})
export const ended = internalAction({
  args: { id: v.id("calls"), at: v.number(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.calling.rows.finish, {
      id: args.id,
      status: "completed",
    })
    await gateway()
      .hangup(args.id)
      .catch(() => undefined)
    return null
  },
})

export const health = action({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await agentActor(ctx, args.organizationId)
    return gateway()
      .healthy()
      .catch(() => false)
  },
})
