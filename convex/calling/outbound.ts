"use node"
import { v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { actorArgs } from "./actor"
import { invalid, apiError } from "../api/caller"
import { checkPermission } from "./settings"
import { connectCall } from "./callActions"
import { permissionAllows } from "../../lib/meta/softphone"
import { outboundRoute, callContext } from "../../lib/calling/outbound"
import { string } from "../../lib/meta/parse"

type Actor = {
  organizationId: string
  caller?: typeof actorArgs.caller.type
  automationRunId?: Id<"automationRuns">
}
export type PlaceCallResult = {
  status:
    | "queued"
    | "ringing"
    | "permission_required"
    | "permission_requested"
    | "calling_limited"
  id?: Id<"calls">
  permission_request_id?: Id<"channelMessages">
  permission?: Record<string, unknown>
}
export async function resolveRecipient(
  ctx: ActionCtx,
  actor: Actor,
  input: Record<string, unknown>
): Promise<{ from: Id<"channelAccounts">; to?: string; recipient?: string }> {
  for (const key of ["from", "to", "recipient", "contact_id"])
    if (input[key] !== undefined && typeof input[key] !== "string")
      throw invalid(`${key} must be a string.`)
  return ctx.runQuery(internal.calling.outboundState.resolve, {
    ...actor,
    from: input.from as string | undefined,
    to: input.to as string | undefined,
    recipient: input.recipient as string | undefined,
    contactId: input.contact_id as string | undefined,
  })
}
export async function requestPermission(
  ctx: ActionCtx,
  actor: Actor,
  input: Record<string, unknown>,
  placeResponse?: Record<string, unknown>
): Promise<{ id: Id<"channelMessages"> }> {
  const target = await resolveRecipient(ctx, actor, input)
  const data = await checkPermission(ctx, {
    ...actor,
    from: target.from,
    identity: target.recipient ?? target.to!,
    bsuid: !!target.recipient,
  })
  if (!permissionAllows(data, "send_call_permission_request"))
    throw apiError(
      429,
      "permission_request_limit",
      "Meta does not allow another calling permission request. Check the permission limits or use an existing permission."
    )
  if (input.text !== undefined && typeof input.text !== "string")
    throw invalid("text must be a string.")
  if (
    input.template !== undefined &&
    (!input.template ||
      typeof input.template !== "object" ||
      Array.isArray(input.template))
  )
    throw invalid("template must be an object.")
  if (input.text !== undefined && input.template !== undefined)
    throw invalid("Supply text or a template.")
  return ctx.runMutation(internal.calling.outboundState.request, {
    ...actor,
    ...target,
    identity: string(data.user_id),
    placeResponse,
    text: input.text as string | undefined,
    template: input.template as Record<string, unknown> | undefined,
  })
}
export async function placeCall(
  ctx: ActionCtx,
  actor: Actor,
  input: Record<string, unknown>
): Promise<PlaceCallResult> {
  let route, context
  try {
    route = outboundRoute(input.route)
    context = callContext(input)
  } catch (error) {
    throw invalid((error as Error).message)
  }
  if (!route) throw invalid("Choose route bot:<id> or ivr:<id>.")
  // Validate the owned route before sending a permission message or allocating media.
  await ctx.runQuery(internal.voice.routing.validate, {
    ...actor,
    input: route,
    mode: "gateway",
    purpose: context.purpose,
    variables: context.variables,
  })
  if (
    input.request_permission !== undefined &&
    typeof input.request_permission !== "boolean"
  )
    throw invalid("request_permission must be a boolean.")
  const target = await resolveRecipient(ctx, actor, input)
  const data = await checkPermission(ctx, {
    ...actor,
    from: target.from,
    identity: target.recipient ?? target.to!,
    bsuid: !!target.recipient,
  })
  if (!permissionAllows(data, "start_call")) {
    if (permissionAllows({ permission: data.permission }, "start_call"))
      return { status: "calling_limited", permission: data }
    if (
      input.request_permission === true &&
      permissionAllows(data, "send_call_permission_request")
    ) {
      const result = await requestPermission(
        ctx,
        actor,
        {
          ...target,
          text: input.permission_text,
          template: input.permission_template,
        },
        { status: "permission_requested", permission: data }
      )
      return {
        status: "permission_requested",
        permission_request_id: result.id,
        permission: data,
      }
    }
    return { status: "permission_required", permission: data }
  }
  const result = await connectCall(ctx, {
    ...actor,
    input: { ...input, ...target },
  })
  return { status: "ringing", id: result.id }
}
export const place = internalAction({
  args: { ...actorArgs, input: v.record(v.string(), v.any()) },
  returns: v.any(),
  handler: (ctx, { input, ...actor }) => placeCall(ctx, actor, input),
})
export const request = internalAction({
  args: { ...actorArgs, input: v.record(v.string(), v.any()) },
  returns: v.object({ id: v.id("channelMessages") }),
  handler: (ctx, { input, ...actor }) => requestPermission(ctx, actor, input),
})
export const dashboardPlace = action({
  args: { organizationId: v.string(), input: v.record(v.string(), v.any()) },
  returns: v.any(),
  handler: (ctx, { input, ...actor }) => placeCall(ctx, actor, input),
})
export const dashboardPermission = action({
  args: { organizationId: v.string(), input: v.record(v.string(), v.any()) },
  returns: v.any(),
  handler: async (
    ctx,
    { input, ...actor }
  ): Promise<Record<string, unknown>> => {
    const target = await resolveRecipient(ctx, actor, input)
    return checkPermission(ctx, {
      ...actor,
      from: target.from,
      identity: target.recipient ?? target.to!,
      bsuid: !!target.recipient,
    })
  },
})
export const dashboardRequest = action({
  args: { organizationId: v.string(), input: v.record(v.string(), v.any()) },
  returns: v.object({ id: v.id("channelMessages") }),
  handler: (ctx, { input, ...actor }) => requestPermission(ctx, actor, input),
})

export const automationPlace = internalAction({
  args: { id: v.id("automationRuns"), key: v.string() },
  returns: v.record(v.string(), v.any()),
  handler: async (ctx, { id, key }): Promise<Record<string, unknown>> => {
    const target = await ctx.runQuery(
      internal.calling.outboundState.automationInput,
      { id, key }
    )
    if ("skipped" in target) return { status: "skipped", reason: target.reason }
    return {
      ...(await placeCall(
        ctx,
        { organizationId: target.organizationId, automationRunId: id },
        target.input
      )),
    }
  },
})
