"use server"

import { createCocomailContact } from "@/lib/cocomail"
import { sendMail, type MailAttachment } from "@/lib/mail"
import { confirmPaidSponsorCheckout } from "@/lib/stripe-sponsors"
import { sponsorTier } from "@/content/landing"
import { SITE } from "@/content/site"

export type SubmitSponsorLogoResult =
  { ok: true } | { ok: false; message: string }

const URL_RE = /^https?:\/\/.+/i
const MAX_LOGO_BYTES = 1_000_000
const LOGO_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/webp",
  "image/jpeg",
])

export async function submitSponsorLogo(
  formData: FormData
): Promise<SubmitSponsorLogoResult> {
  const company = String(formData.get("company") ?? "").trim()
  const website = String(formData.get("website") ?? "").trim()
  const sessionId = String(formData.get("sessionId") ?? "").trim()
  const logo = formData.get("logo")
  const logoDark = formData.get("logoDark")

  if (!company) {
    return { ok: false, message: "Enter the company name." }
  }
  if (!URL_RE.test(website)) {
    return { ok: false, message: "Enter a website URL starting with https://" }
  }

  const paid = await confirmPaidSponsorCheckout(sessionId)
  if (!paid) {
    return { ok: false, message: "We could not confirm that payment." }
  }
  const paidEmail = paid.email
  const tierLabel = sponsorTier(paid.tier).name

  const light = await readLogo(logo, "logo")
  if (!light.ok) return light
  if (!light.file) {
    return { ok: false, message: "Choose a logo file." }
  }
  const dark = await readLogo(logoDark, "dark logo", true)
  if (!dark.ok) return dark

  await createCocomailContact({
    email: paidEmail,
    tags: ["opensend.cc", "opensend.cc-sponsor-logo"],
  })

  const attachments: MailAttachment[] = [light.file]
  if (dark.file) attachments.push(dark.file)

  const operator = await sendMail({
    to: SITE.email,
    subject: `${tierLabel} logo from ${company}`,
    text: [
      `${company} uploaded a logo for a ${tierLabel} spot.`,
      "",
      `Email: ${paidEmail}`,
      `Website: ${website}`,
      `Stripe session: ${sessionId}`,
      "",
      "Put the files in public/logos/sponsors and add the company to SPONSORS.items.",
    ].join("\n"),
    attachments,
  })
  if (!operator.ok) {
    return {
      ok: false,
      message: "Could not send the logo. Try again in a moment.",
    }
  }

  return { ok: true }
}

async function readLogo(
  value: FormDataEntryValue | null,
  label: string,
  optional = false
): Promise<
  | { ok: true; file: MailAttachment }
  | { ok: true; file: null }
  | { ok: false; message: string }
> {
  if (!(value instanceof File) || value.size === 0) {
    if (optional) return { ok: true, file: null }
    return { ok: false, message: `Choose a ${label} file.` }
  }
  if (value.size > MAX_LOGO_BYTES) {
    return { ok: false, message: `${label} must be under 1 MB.` }
  }
  const type = value.type || guessType(value.name)
  if (!LOGO_TYPES.has(type)) {
    return { ok: false, message: `${label} must be SVG, PNG, WebP, or JPEG.` }
  }
  const buffer = Buffer.from(await value.arrayBuffer())
  return {
    ok: true,
    file: {
      filename: value.name || `${label.replace(" ", "-")}.png`,
      content: buffer.toString("base64"),
      contentType: type,
    },
  }
}

function guessType(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  return ""
}
