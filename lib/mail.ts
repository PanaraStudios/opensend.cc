import { SITE } from "@/content/site"
import {
  sendCocomailEmail,
  type MailAttachment,
  type MailInput,
  type SendMailResult,
} from "@/lib/cocomail"

export type { MailAttachment, SendMailResult }

/* Operator mail only (new sponsor, logo files, cancelled sub). Goes through
   Resend when a key is set, and through Cocomail when it is not or Resend
   fails. */
export async function sendMail(input: {
  to: string
  subject: string
  text: string
  attachments?: MailAttachment[]
}): Promise<SendMailResult> {
  /* Sent from an address whose domain the provider has verified, which need
     not be the one people write to. */
  const from = process.env.MAIL_FROM?.trim() || SITE.email
  const mail: MailInput = { ...input, from, replyTo: SITE.email }

  const resend = process.env.RESEND_API_KEY?.trim()
  if (resend) {
    const result = await sendResend(resend, mail)
    if (result.ok) return result
    console.error("Resend send failed", result.message)
  }

  const result = await sendCocomailEmail(mail)
  if (!result.ok) console.error("Cocomail send failed", result.message)
  return result
}

async function sendResend(
  key: string,
  mail: MailInput
): Promise<SendMailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SITE.name} <${mail.from}>`,
        to: [mail.to],
        reply_to: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments?.map((file) => ({
          filename: file.filename,
          content: file.content,
          content_type: file.contentType,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      return { ok: false, message: `Resend ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    console.error("Resend request failed", error)
    return { ok: false, message: "Resend request failed." }
  }
}
