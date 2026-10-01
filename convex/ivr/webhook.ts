"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { publicFetch } from "../../lib/net/public-fetch"
import { webhookHeaders } from "../../lib/webhooks/signing"
import { parseIvrAction } from "../../lib/ivr"
import { randomUUID } from "node:crypto"
/** A single, bounded signed POST. No retries: a decision can have external effects. */
export const decide = internalAction({
  args: {
    callId: v.id("calls"),
    ivrId: v.id("ivrs"),
    menuId: v.string(),
    digits: v.string(),
    url: v.string(),
    secretId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.ivr.runtime.webhookContext, {
      callId: args.callId,
      ivrId: args.ivrId,
      secretId: args.secretId,
    })
    const body = JSON.stringify({
      call: target.call,
      ivrId: args.ivrId,
      menuId: args.menuId,
      digits: args.digits,
    })
    const response = await publicFetch(args.url, {
      method: "POST",
      body,
      headers: await webhookHeaders({
        id: randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
        body,
        secret: target.secret,
      }),
      timeoutMs: 3000,
      maxBytes: 8192,
    })
    if (!response.ok) throw new Error("IVR webhook failed")
    const raw: unknown = await response.json()
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some((k) => k !== "action")
    )
      throw new Error("Expected {action}")
    const selected = parseIvrAction((raw as { action?: unknown }).action, false)
    if (
      selected.kind === "submenu" &&
      !target.definition.menus.some(
        (m: { id: string }) => m.id === selected.menuId
      )
    )
      throw new Error("Unknown submenu")
    return selected
  },
})
