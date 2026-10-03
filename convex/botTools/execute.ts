"use node"
import { v } from "convex/values"
import { internalAction, action, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import { actor } from "../botToolkitAccess"
import { type Caller } from "../api/caller"
import { decryptSecret } from "../secrets"
import { executeBotWebhook } from "../../lib/net/bot-webhook"
import { validateToolSchema } from "../../lib/bot-toolkit"
export async function executeTool(row: Doc<"botTools">, input: unknown) {
  return executeBotWebhook(
    {
      ...row,
      parameters: validateToolSchema(JSON.parse(row.parameters)),
      headers: JSON.parse(await decryptSecret(row.encryptedHeaders)),
      signingSecret: await decryptSecret(row.encryptedSigningSecret),
    },
    input
  )
}
async function testTool(
  ctx: ActionCtx,
  args: {
    organizationId: string
    caller?: Caller
    id: string
    input: Record<string, unknown>
  }
): Promise<unknown> {
  const row: Doc<"botTools"> = await ctx.runQuery(
    internal.botTools.resources.authorized,
    { organizationId: args.organizationId, caller: args.caller, id: args.id }
  )
  const started = Date.now()
  const result = await executeTool(row, args.input)
  return { ...result, latencyMs: Date.now() - started }
}
export const test = internalAction({
  args: { ...actor, id: v.string(), input: v.record(v.string(), v.any()) },
  returns: v.any(),
  handler: testTool,
})
export const dashboardTest = action({
  args: {
    organizationId: v.string(),
    id: v.string(),
    input: v.record(v.string(), v.any()),
  },
  returns: v.any(),
  handler: testTool,
})
