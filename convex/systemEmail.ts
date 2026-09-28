import { v, ConvexError } from "convex/values"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import { findInstallation, requireInstallationAdmin } from "./access"
import { authEmailContent, logAuthEmail } from "./authEmail"
import { SYSTEM_SCOPE, createEmail, errorMessage } from "./emails"
import { parseMailbox, senderDomainOf } from "../lib/dashboard/email-send"

import { components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"

const kindValue = v.union(
  v.literal("verify"),
  v.literal("reset"),
  v.literal("change-email"),
  v.literal("invite")
)

/** Sends one account email through the system sender, or logs it for the bootstrap account when
    none is set. Its row is scoped to no team, so no Emails screen lists
    it, and its body is dropped once it is sent. */
export const send = internalMutation({
  args: { to: v.string(), kind: kindValue, url: v.string() },
  returns: v.null(),
  handler: async (ctx, email) => {
    const sender = (await findInstallation(ctx))?.systemSender
    if (!sender) {
      if (
        await ctx.runQuery(components.betterAuth.policy.bootstrapRecipient, {
          email: email.to,
        })
      ) {
        logAuthEmail(email)
        return null
      }
      console.warn("Account email withheld: no system sender")
      throw new ConvexError(
        "Account email isn't set up yet. Ask your administrator to choose a sender in Amazon SES settings."
      )
    }
    const content = authEmailContent(email)
    try {
      await sendSystemEmail(ctx, {
        to: email.to,
        category: email.kind,
        ...content,
      })
    } catch (e) {
      // The message carries a one-time link, so only the reason is logged.
      console.error(
        `Account email not sent: ${errorMessage(e) ?? "unexpected error"}`
      )
      if (!(e instanceof ConvexError)) throw e
    }
    return null
  },
})

/** The live domain a system sender address sends from, or throw. */
async function systemSenderDomain(
  ctx: MutationCtx,
  from: string,
  domainId?: Id<"domains">
) {
  const mailbox = parseMailbox(from)
  if (!mailbox)
    throw new ConvexError(
      "Use an address like `Opensend <no-reply@example.com>`"
    )
  const name = senderDomainOf(mailbox)
  const domain = domainId
    ? await ctx.db.get("domains", domainId)
    : await ctx.db
        .query("domains")
        .withIndex("by_deleted_and_status_and_sending_and_name", (q) =>
          q
            .eq("deleted", false)
            .eq("status", "verified")
            .eq("sending", true)
            .eq("name", name)
        )
        .first()
  if (
    !domain ||
    domain.deleted ||
    domain.status !== "verified" ||
    !domain.sending ||
    domain.name !== name
  )
    throw new ConvexError(
      domainId
        ? "Choose a verified sending domain matching the from address"
        : `No team has \`${name}\` verified with sending enabled`
    )
  return domain
}

/** Common system queue for account mail and export notifications. */
export async function sendSystemEmail(
  ctx: MutationCtx,
  email: {
    to: string
    subject: string
    text: string
    html?: string
    category: string
  }
) {
  const sender = (await findInstallation(ctx))?.systemSender
  if (!sender) return null
  return createEmail(
    ctx,
    {
      from: sender.from,
      to: [email.to],
      cc: [],
      bcc: [],
      replyTo: [],
      headers: [],
      attachments: [],
      tags: [{ name: "category", value: email.category }],
      subject: email.subject,
      text: email.text,
      html: email.html,
    },
    {
      organizationId: SYSTEM_SCOPE,
      source: "system",
      systemDomain: sender.domainId,
    }
  )
}

/** CLI and dashboard share address validation and the live SES send gate. */
export async function configureSystemSender(
  ctx: MutationCtx,
  from?: string,
  domainId?: Id<"domains">
): Promise<null> {
  const installation = await findInstallation(ctx)
  if (!installation) throw new ConvexError("Finish installation setup first")
  if (from === undefined) {
    await ctx.db.patch("installation", installation._id, {
      systemSender: undefined,
    })
    return null
  }
  const domain = await systemSenderDomain(ctx, from, domainId)
  await ctx.runQuery(internal.ses.sendContext.get, {
    organizationId: domain.organizationId,
    domainId: domain._id,
  })
  await ctx.db.patch("installation", installation._id, {
    systemSender: { from: from.trim(), domainId: domain._id },
  })
  return null
}

export const settings = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ from: v.string(), domainId: v.id("domains") })
  ),
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    return (await findInstallation(ctx))?.systemSender ?? null
  },
})

export const setSender = mutation({
  args: { from: v.optional(v.string()), domainId: v.optional(v.id("domains")) },
  returns: v.null(),
  handler: async (ctx, { from, domainId }): Promise<null> => {
    await requireInstallationAdmin(ctx)
    return configureSystemSender(ctx, from, domainId)
  },
})

/** Installation scope deliberately includes domains owned by any team. */
export const domains = query({
  args: { search: v.optional(v.string()) },
  returns: v.array(schema.doc("domains").pick("_id", "name", "region")),
  handler: async (ctx, { search }) => {
    await requireInstallationAdmin(ctx)
    const prefix = search?.trim().toLowerCase() ?? ""
    return (
      await ctx.db
        .query("domains")
        .withIndex("by_deleted_and_status_and_sending_and_name", (q) =>
          q
            .eq("deleted", false)
            .eq("status", "verified")
            .eq("sending", true)
            .gte("name", prefix)
            .lt("name", prefix + "\uffff")
        )
        .take(100)
    ).map(({ _id, name, region }) => ({ _id, name, region }))
  },
})
