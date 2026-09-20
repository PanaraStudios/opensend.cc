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
/** Swap this transport for SMTP without changing callers or templates. */
export function sendAuthEmail({ to, kind, url }: AuthEmail) {
  const [subject, content] = templates[kind]
  console.log(
    JSON.stringify({
      event: "auth.email",
      to,
      subject,
      content,
      actionLink: url,
    })
  )
}
