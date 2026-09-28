import type { GenericCtx } from "@convex-dev/better-auth"
import { internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { escapeHtml } from "../lib/dashboard/email-variables"

export type AuthEmail = {
  to: string
  kind: "verify" | "reset" | "change-email" | "invite"
  url: string
}
const templates = {
  verify: ["Verify your email", "Verify your email address to use Opensend."],
  reset: [
    "Reset your password",
    "Choose a new password for your Opensend account.",
  ],
  "change-email": [
    "Confirm your email change",
    "Confirm the change to your Opensend email address.",
  ],
  invite: [
    "Join your Opensend team",
    "You have been invited to an Opensend team. Sign in or create your account to respond.",
  ],
} as const

/** The message: plain text and a simple HTML part with the one link. */
export function authEmailContent({ kind, url }: Omit<AuthEmail, "to">) {
  const [subject, content] = templates[kind]
  return {
    subject,
    text: `${content}\n\n${subject}: ${url}\n`,
    html: `<p>${escapeHtml(content)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(subject)}</a></p>`,
  }
}

/** Only systemEmail.send may call this, after checking the bootstrap account. */
export function logAuthEmail({ to, kind, url }: AuthEmail) {
  const { subject } = authEmailContent({ kind, url })
  console.log(
    JSON.stringify({
      event: "auth.email",
      to,
      subject,
      content: templates[kind][1],
      actionLink: url,
    })
  )
}

/** Sends through the installation's system sender when one is set
    (`installationAdmin:setSystemSender`); account email requires a writable context. */
export async function sendAuthEmail(
  ctx: GenericCtx<DataModel>,
  email: AuthEmail
) {
  if ("runMutation" in ctx)
    await ctx.runMutation(internal.systemEmail.send, email)
  else throw new Error("Account email requires a writable context")
}
