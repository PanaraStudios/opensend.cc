import { SITE } from "@/content/site"

const COCOMAIL_BASE_URL = "https://cocomail.cc/v1"

export type SendMailResult = { ok: true } | { ok: false; message: string }

/* Operator mail only (new sponsor, logo files, cancelled sub). Tries
   Resend if a key is set, then Cocomail. */

export type MailAttachment = {
  filename: string
  content: string
  contentType: string
}

export async function sendMail(input: {
  to: string
  subject: string
  text: string
  replyTo?: string
  attachments?: MailAttachment[]
}): Promise<SendMailResult> {
  const resend = process.env.RESEND_API_KEY?.trim()
  if (resend) {
    const result = await sendResend(resend, input)
    if (result.ok) return result
    console.error("Resend send failed", result.message)
  }

  const cocomail = process.env.NEXT_COCOMAIL_API_KEY?.trim()
  if (cocomail) {
    const result = await sendCocomail(cocomail, input)
    if (result.ok) return result
    console.error("Cocomail send failed", result.message)
  }

  return {
    ok: false,
    message: "No mail provider is configured.",
  }
}

async function sendResend(
  key: string,
  input: {
    to: string
    subject: string
    text: string
    replyTo?: string
    attachments?: MailAttachment[]
  }
): Promise<SendMailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SITE.name} <${SITE.email}>`,
        to: [input.to],
        reply_to: input.replyTo ?? SITE.email,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments?.map((file) => ({
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

async function sendCocomail(
  key: string,
  input: {
    to: string
    subject: string
    text: string
    replyTo?: string
    attachments?: MailAttachment[]
  }
): Promise<SendMailResult> {
  try {
    const response = await fetch(`${COCOMAIL_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: input.to,
        from: SITE.email,
        replyTo: input.replyTo ?? SITE.email,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return { ok: false, message: `Cocomail ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    console.error("Cocomail send request failed", error)
    return { ok: false, message: "Cocomail request failed." }
  }
}
