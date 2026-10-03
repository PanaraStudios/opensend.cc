"use node"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { envelope } from "./gateway"
import { executeTool } from "../botTools/execute"
import { searchKnowledge } from "../knowledge/search"
export const run = internalAction({
  args: envelope,
  handler: async (ctx, args): Promise<unknown> => {
    const started = Date.now()
    const prepared: {
      result?: unknown
      logId?: Id<"callTranscripts">
      call?: Doc<"calls">
      tool?: Doc<"botTools"> | null
      input?: Record<string, unknown>
    } = await ctx.runMutation(internal.voice.toolkitState.begin, args)
    if (prepared.result) return prepared.result
    let result: unknown
    try {
      const call = prepared.call!
      result = prepared.tool
        ? await executeTool(prepared.tool, prepared.input!)
        : {
            ok: true,
            result: await searchKnowledge(ctx, {
              organizationId: call.organizationId,
              knowledgeBaseIds: call.botConfig!.knowledgeBaseIds ?? [],
              query: String(prepared.input!.query),
              trusted: true,
            }),
          }
    } catch {
      result = {
        ok: false,
        error:
          "Knowledge search could not be completed; check the team's Gemini key and knowledge status",
      }
    }
    await ctx.runMutation(internal.voice.toolkitState.finish, {
      logId: prepared.logId!,
      result: JSON.stringify(result),
      latencyMs: Date.now() - started,
    })
    return result
  },
})
