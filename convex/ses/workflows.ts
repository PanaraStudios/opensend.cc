import {
  WorkflowManager,
  vResultValidator,
  vWorkflowId,
  type WorkflowId,
} from "@convex-dev/workflow"
import { v } from "convex/values"
import type { FunctionArgs, FunctionReference } from "convex/server"
import { components, internal } from "../_generated/api"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
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
    context: v.any(),
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
export const provisionRegion = workflow
  .define({ args: { regionId: v.id("sesRegions") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.ses.provision.region, args, {
        retry: false,
      })
    } catch {
      await step.runMutation(internal.ses.state.patchRegion, {
        id: args.regionId,
        changes: {
          phase: "failed",
          error:
            "Provisioning stopped. Check AWS permissions and retry; existing owned resources will be reused.",
        },
      })
    }
    return null
  })
export const domainOperationWithTenant = workflow
  .define({ args: { domainId: v.id("domains") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    try {
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
