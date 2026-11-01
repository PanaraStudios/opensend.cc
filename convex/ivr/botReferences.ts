import type { MutationCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { ivrBotIds } from "../../lib/ivr-bot-references"
import { IVR_LIMITS } from "../../lib/ivr"

/** Most bot references one IVR can hold: every option, no-input and failure
    action of every menu, plus the closed-hours action. */
const MAX_REFERENCES = IVR_LIMITS.menus * (IVR_LIMITS.options + 2) + 1

/** Makes the IVR's reference rows match the bots it currently routes to. */
export async function syncIvrBotReferences(ctx: MutationCtx, ivr: Doc<"ivrs">) {
  const wanted = new Set(ivrBotIds(ivr))
  const rows = await ctx.db
    .query("ivrBotReferences")
    .withIndex("by_ivrId", (q) => q.eq("ivrId", ivr._id))
    .take(MAX_REFERENCES)
  for (const row of rows)
    if (!wanted.delete(row.botId))
      await ctx.db.delete("ivrBotReferences", row._id)
  for (const botId of wanted)
    await ctx.db.insert("ivrBotReferences", {
      organizationId: ivr.organizationId,
      ivrId: ivr._id,
      botId: botId as Id<"voiceBots">,
    })
}

export async function dropIvrBotReferences(
  ctx: MutationCtx,
  ivrId: Id<"ivrs">
) {
  const rows = await ctx.db
    .query("ivrBotReferences")
    .withIndex("by_ivrId", (q) => q.eq("ivrId", ivrId))
    .take(MAX_REFERENCES)
  for (const row of rows) await ctx.db.delete("ivrBotReferences", row._id)
}
