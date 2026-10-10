import { OpenSend, vOnEmailEventArgs } from "@opensendcc/convex"
import { v } from "convex/values"
import { components, internal } from "./_generated/api.js"
import { env, internalMutation, internalQuery } from "./_generated/server.js"

// Construct inside handlers: typed env is only available at runtime.
export function opensend(): OpenSend {
  return new OpenSend(components.opensend, {
    apiKey: env.OPENSEND_API_KEY,
    baseUrl: env.OPENSEND_BASE_URL,
    webhookSecret: env.OPENSEND_WEBHOOK_SECRET,
    onEmailEvent: internal.email.onEmailEvent,
  })
}
export const send = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          content: v.string(),
        })
      )
    ),
  },
  returns: v.string(),
  handler: (ctx, args): Promise<string> => opensend().sendEmail(ctx, args),
})
export const sendTemplate = internalMutation({
  args: {
    to: v.string(),
    template: v.object({
      id: v.string(),
      variables: v.optional(
        v.record(v.string(), v.union(v.string(), v.number()))
      ),
    }),
  },
  returns: v.string(),
  handler: (ctx, args): Promise<string> => opensend().sendEmail(ctx, args),
})
export const status = internalQuery({
  args: { id: v.string() },
  handler: (ctx, { id }) => opensend().status(ctx, id),
})
export const cancel = internalMutation({
  args: { id: v.string() },
  returns: v.boolean(),
  handler: (ctx, { id }) => opensend().cancelEmail(ctx, id),
})
export const sendAndCancel = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id = await opensend().sendEmail(ctx, args)
    await opensend().cancelEmail(ctx, id)
    return id
  },
})
export const onEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("emailEvents", { emailId: args.id, event: args.event })
    return null
  },
})
export const events = internalQuery({
  args: { id: v.string() },
  handler: (ctx, { id }) =>
    ctx.db
      .query("emailEvents")
      .withIndex("by_emailId", (q) => q.eq("emailId", id))
      .take(100),
})
export const cleanup = internalMutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: (ctx, args) => opensend().cleanupOldEmails(ctx, args),
})
