import {
  WorkflowManager,
  vResultValidator,
  vWorkflowId,
  type WorkflowCtx,
  type WorkflowId,
} from "@convex-dev/workflow"
import { v } from "convex/values"
import type { FunctionArgs, FunctionReference } from "convex/server"
import { components, internal } from "../_generated/api"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { regionValue } from "./contracts"
export const workflow = new WorkflowManager(components.workflow)
/** Every workflow is started with `cleanup`, so no journal outlives its run. */
export function startWorkflow<
  F extends FunctionReference<"mutation", "internal">,
>(
  ctx: MutationCtx,
  ref: F,
  args: FunctionArgs<F>["args"]
): Promise<WorkflowId> {
  return workflow.start(ctx, ref, args, {
    onComplete: internal.ses.workflows.cleanup,
    context: null,
  })
}
/** The component never reclaims a finished workflow's journal on its own. */
export const cleanup = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.null(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await workflow.cleanup(ctx, args.workflowId)
    return null
  },
})
export const tenantOperation = workflow
  .define({
    args: { tenantId: v.id("sesTenants"), generation: v.number() },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.ses.tenantActions.run, args, {
        retry: false,
      })
    } catch {
      await step.runMutation(internal.tenants.finish, {
        id: args.tenantId,
        generation: args.generation,
        error:
          "SES tenant setup stopped. Retry after checking AWS permissions.",
      })
    }
    return null
  })
/** Provisions one region; a run that stops marks the region failed. */
async function provisionRegionStep(
  step: WorkflowCtx,
  regionId: Id<"sesRegions">
) {
  try {
    await step.runAction(
      internal.ses.provision.region,
      { regionId },
      { retry: false }
    )
  } catch {
    await step.runMutation(internal.ses.state.patchRegion, {
      id: regionId,
      changes: {
        phase: "failed",
        error:
          "Provisioning stopped. Check AWS permissions and retry; existing owned resources will be reused.",
      },
    })
  }
}
export const provisionRegion = workflow
  .define({ args: { regionId: v.id("sesRegions") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    await provisionRegionStep(step, args.regionId)
    return null
  })
/** After the public URL moved: provisions every region again, which
    subscribes the new URL to its topic, then refreshes every domain so its
    tracking records follow. Domain refreshes need their region ready, so
    they start once every region has finished. */
export const moveCallbackOrigin = workflow
  .define({
    args: {
      regionIds: v.array(v.id("sesRegions")),
      regions: v.array(regionValue),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    await Promise.all(
      args.regionIds.map((regionId) => provisionRegionStep(step, regionId))
    )
    for (const region of args.regions) {
      let cursor: string | null = null
      do {
        cursor = await step.runMutation(internal.domains.refreshForNewOrigin, {
          region,
          cursor,
        })
      } while (cursor)
    }
    return null
  })
export const inboundRegion = workflow
  .define({
    args: { id: v.id("inboundRegions"), generation: v.number() },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.ses.inbound.region, args, {
        retry: false,
      })
    } catch {
      await step.runMutation(internal.ses.inboundRegions.finish, {
        ...args,
        changes: {},
        error:
          "Inbound mail setup stopped. Check AWS permissions and retry; existing owned resources will be reused.",
      })
    }
    return null
  })
export const domainOperationWithTenant = workflow
  .define({ args: { domainId: v.id("domains") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    try {
      // The domain's own step reports a region whose setup did not finish.
      const inboundId = await step.runMutation(
        internal.ses.inboundRegions.prepare,
        args
      )
      if (inboundId)
        for (let attempt = 0; attempt < 90; attempt++) {
          const state = await step.runMutation(
            internal.ses.inboundRegions.poll,
            { id: inboundId }
          )
          if (state === "settled") break
          await step.sleep(2000)
        }
      const tenantId = await step.runMutation(
        internal.tenants.prepareDomain,
        args
      )
      if (tenantId) {
        let ready = false
        for (let attempt = 0; attempt < 60; attempt++) {
          const tenant: Doc<"sesTenants"> | null = await step.runQuery(
            internal.tenants.get,
            { id: tenantId }
          )
          if (
            !tenant ||
            tenant.deleted ||
            tenant.operation === "remove" ||
            tenant.phase === "failed"
          )
            throw new Error("SES tenant setup failed")
          if (tenant.phase === "ready") {
            ready = true
            break
          }
          await step.sleep(2000)
        }
        if (!ready) throw new Error("SES tenant setup is still pending")
      }
      await step.runAction(internal.ses.provision.domain, args, {
        retry: false,
      })
    } catch {
      await step.runMutation(internal.domains.finish, {
        id: args.domainId,
        changes: {},
        error:
          "Domain operation stopped. Retry after checking AWS permissions.",
      })
    }
    return null
  })
