import { v } from "convex/values"
import { insertTranscript, toolLimitReached } from "./transcriptCounts"
import { internalMutation } from "../_generated/server"
import { envelope, nonce, gatewayCall, callTimestamp } from "./gateway"
import { object, string } from "../../lib/meta/parse"
import {
  validateToolArguments,
  validateToolSchema,
} from "../../lib/bot-toolkit"
export const begin = internalMutation({
  args: envelope,
  returns: v.any(),
  handler: async (ctx, args) => {
    await nonce(ctx, args)
    const call = await gatewayCall(ctx, args.data),
      request = object(args.data.toolCall),
      name = string(request.name),
      id = string(request.id),
      input = object(request.arguments)
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id))
      return { result: { ok: false, error: "Invalid tool id" } }
    let tool = null
    if (name === "search_knowledge") {
      if (
        !call.botConfig!.knowledgeBaseIds?.length ||
        Object.keys(input).length !== 1 ||
        typeof input.query !== "string" ||
        !input.query.trim() ||
        input.query.length > 4096
      )
        return {
          result: {
            ok: false,
            error: "Knowledge search is not enabled or the query is invalid",
          },
        }
    } else {
      const row = await ctx.db
        .query("botTools")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", call.organizationId).eq("name", name)
        )
        .unique()
      if (!row || !call.botConfig!.customToolIds?.includes(row._id))
        return {
          result: { ok: false, error: "Tool is not enabled for this bot" },
        }
      try {
        validateToolArguments(
          validateToolSchema(JSON.parse(row.parameters)),
          input
        )
      } catch {
        return { result: { ok: false, error: "Invalid tool arguments" } }
      }
      tool = row
    }
    const serialized = JSON.stringify(input)
    const previous = await ctx.db
      .query("callTranscripts")
      .withIndex("by_callId_and_toolId", (q) =>
        q.eq("callId", call._id).eq("toolId", id)
      )
      .unique()
    if (previous)
      return {
        result:
          previous.toolName === name && previous.arguments === serialized
            ? JSON.parse(previous.result!)
            : { ok: false, error: "Tool id reused with different arguments" },
      }
    if (await toolLimitReached(ctx, call))
      return { result: { ok: false, error: "Call tool limit reached" } }
    const logId = await insertTranscript(ctx, {
      organizationId: call.organizationId,
      callId: call._id,
      eventId: `tool:${id}`,
      kind: "tool",
      timestampMs: callTimestamp(call),
      timeline: "call",
      toolId: id,
      toolName: name,
      arguments: serialized,
      result: JSON.stringify({
        ok: false,
        error: "This tool request is already running; do not repeat it",
      }),
    })
    // Reserve before network I/O: replays never repeat webhook side effects.
    return { logId, call, tool, input }
  },
})
export const finish = internalMutation({
  args: {
    logId: v.id("callTranscripts"),
    result: v.string(),
    latencyMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.result.length > 65536) throw new Error("Tool result too large")
    const row = await ctx.db.get("callTranscripts", args.logId)
    if (!row) return null
    await ctx.db.patch("callTranscripts", row._id, {
      result: args.result,
    })
    await insertTranscript(ctx, {
      organizationId: row.organizationId,
      callId: row.callId,
      eventId: crypto.randomUUID(),
      kind: "media",
      timestampMs: row.timestampMs + args.latencyMs,
      timeline: row.timeline,
      text: JSON.stringify({
        type: "tool_call",
        toolName: row.toolName,
        status: JSON.parse(args.result).ok ? "succeeded" : "failed",
        latencyMs: args.latencyMs,
      }),
    })
    return null
  },
})
