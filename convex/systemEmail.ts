import { v, ConvexError } from "convex/values"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { findInstallation } from "./access"
import { authEmailContent, logAuthEmail } from "./authEmail"
import { SYSTEM_SCOPE, createEmail, errorMessage } from "./emails"
import { parseMailbox, senderDomainOf } from "../lib/dashboard/email-send"

const kindValue = v.union(
  v.literal("verify"),
  v.literal("reset"),
  v.literal("change-email"),
  v.literal("invite")
)

/** Sends one account email through the system sender, or logs it when
    none is set. Its row is scoped to no team, so no Emails screen lists
    it, and its body is dropped once it is sent. */
export const send = internalMutation({
  args: { to: v.string(), kind: kindValue, url: v.string() },
  returns: v.null(),
  handler: async (ctx, email) => {
    const sender = (await findInstallation(ctx))?.systemSender
    if (!sender) {
      logAuthEmail(email)
      return null
    }
    const content = authEmailContent(email)
    try {
      await createEmail(
        ctx,
        {
          from: sender.from,
          to: [email.to],
          cc: [],
          bcc: [],
          replyTo: [],
          headers: [],
          attachments: [],
          tags: [{ name: "category", value: email.kind }],
          ...content,
        },
        {
          organizationId: SYSTEM_SCOPE,
          source: "system",
          systemDomain: sender.domainId,
        }
      )
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
export async function systemSenderDomain(ctx: MutationCtx, from: string) {
  const mailbox = parseMailbox(from)
  if (!mailbox)
    throw new ConvexError(
      "Use an address like `Opensend <no-reply@example.com>`"
    )
  const name = senderDomainOf(mailbox)
  const domains = await ctx.db
    .query("domains")
    .withIndex("by_name_and_region_and_deleted", (q) => q.eq("name", name))
    .take(20)
  const domain = domains.find(
    (row) => !row.deleted && row.status === "verified" && row.sending
  )
  if (!domain)
    throw new ConvexError(
      `No team has \`${name}\` verified with sending enabled`
    )
  return domain
}
