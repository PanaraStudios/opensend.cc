import { ConvexError, v } from "convex/values"
import { mutation } from "./_generated/server"
import { requireTeam } from "./access"
import { createEmail } from "./emails"
import { renderEmail } from "./email/render"
import {
  findDraft,
  renderTemplate,
  resolvedVariables,
  TEMPLATE_BODY_LIMIT,
} from "./templates"

/** Both editors send their current export. Broadcast persistence lands in wave 5. */
export const send = mutation({
  args: {
    organizationId: v.string(),
    templateId: v.optional(v.id("templates")),
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    if (new TextEncoder().encode(args.html).length > TEMPLATE_BODY_LIMIT)
      throw new ConvexError("The template HTML is larger than 256 KB")
    let content
    if (args.templateId) {
      const template = await ctx.db.get("templates", args.templateId)
      if (!template || template.organizationId !== args.organizationId)
        throw new ConvexError(
          "You do not have permission to access this template"
        )
      const draft = await findDraft(ctx, template._id)
      const snapshot = {
        ...template,
        subject: args.subject,
        html: args.html,
        text: draft?.text,
      }
      content = renderTemplate(
        { ...snapshot, variables: resolvedVariables(snapshot, snapshot) },
        {}
      )
    } else content = renderEmail({ subject: args.subject, html: args.html }, {})
    return createEmail(
      ctx,
      {
        from: args.from,
        to: [args.to],
        ...content,
        cc: [],
        bcc: [],
        replyTo: [],
        headers: [],
        attachments: [],
        tags: [],
      },
      { organizationId: args.organizationId, source: "dashboard" }
    )
  },
})
