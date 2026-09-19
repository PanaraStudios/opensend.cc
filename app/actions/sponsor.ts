"use server"

import { createCocomailContact } from "@/lib/cocomail"
import { sendMail, type MailAttachment } from "@/lib/mail"
import { LOGO_MAX_BYTES, logoFilename, logoType } from "@/lib/sponsor-logo"
import {
  confirmPaidSponsorCheckout,
  markLogoSubmitted,
} from "@/lib/stripe-sponsors"
import { SPONSORS_THANKS, sponsorTier } from "@/content/landing"
import { SITE } from "@/content/site"

type Result = { ok: true } | { ok: false; message: string }

const URL_RE = /^https:\/\/.+/i
const copy = SPONSORS_THANKS.form

export async function submitSponsorLogo(formData: FormData): Promise<Result> {
  const company = String(formData.get("company") ?? "").trim()
  const website = String(formData.get("website") ?? "").trim()
  const sessionId = String(formData.get("sessionId") ?? "")
  const logo = formData.get("logo")
  const logoDark = formData.get("logoDark")

  if (!company) {
    return { ok: false, message: copy.errors.company }
  }
  if (!URL_RE.test(website)) {
    return { ok: false, message: copy.errors.website }
  }

  /* What can be told from the files alone is checked before Stripe is asked
     anything; they are only read once the payment stands. */
  if (!isUpload(logo)) {
    return { ok: false, message: copy.errors.logoMissing }
  }
  const problem =
    logoProblem(logo, copy.logoLabel) ??
    (isUpload(logoDark) ? logoProblem(logoDark, copy.logoDarkLabel) : null)
  if (problem) return { ok: false, message: problem }

  const paid = await confirmPaidSponsorCheckout(sessionId)
  if (!paid) {
    return { ok: false, message: copy.errors.unpaid }
  }
  if (paid.logoSubmitted) {
    return { ok: false, message: copy.errors.alreadySent }
  }
  const tierLabel = sponsorTier(paid.tier).name

  const attachments = [await attachment(logo, "logo")]
  if (isUpload(logoDark)) {
    attachments.push(await attachment(logoDark, "logo-dark"))
  }

  /* The tag is a nicety; the mail is what gets the logo onto the site. */
  const [, operator] = await Promise.all([
    createCocomailContact({
      email: paid.email,
      tags: ["opensend.cc", "opensend.cc-sponsor-logo"],
    }),
    sendMail({
      to: SITE.email,
      subject: `${tierLabel} logo from ${company}`,
      text: [
        `${company} uploaded a logo for a ${tierLabel} spot.`,
        "",
        `Email: ${paid.email}`,
        `Website: ${website}`,
        `Stripe session: ${paid.sessionId}`,
        "",
        "Put the files in public/logos/sponsors and add the company to SPONSORS.items.",
      ].join("\n"),
      attachments,
    }),
  ])
  if (!operator.ok) {
    return { ok: false, message: copy.errors.sendFailed }
  }

  await markLogoSubmitted(paid.sessionId)
  return { ok: true }
}

/** An empty file input still sends a File, of no size. */
function isUpload(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0
}

function logoProblem(file: File, label: string): string | null {
  if (file.size > LOGO_MAX_BYTES) return copy.errors.tooLarge(label)
  if (!logoType(file)) return copy.errors.badType(label)
  return null
}

async function attachment(file: File, name: string): Promise<MailAttachment> {
  return {
    filename: logoFilename(file, name),
    content: Buffer.from(await file.arrayBuffer()).toString("base64"),
    contentType: logoType(file) ?? file.type,
  }
}
