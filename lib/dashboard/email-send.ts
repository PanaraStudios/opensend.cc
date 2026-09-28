import { parseSchedule } from "./schedule"

/* Checks a send request's fields the way SES and Resend define them. Pure,
   so the REST API and its tests share one copy. */

export type Mailbox = { name?: string; address: string }

const ADDRESS =
  /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[^\s@<>()[\]",;:\\]+$/

/** `a@b.co`, `Name <a@b.co>` or `"Last, First" <a@b.co>`; null otherwise.
    Line breaks are refused, so a value can never add a header. */
export function parseMailbox(value: string): Mailbox | null {
  const text = value.trim()
  if (!text || /[\r\n]/.test(text)) return null
  const named = text.match(/^(.*?)\s*<([^<>]+)>$/)
  const address = (named ? named[2] : text).trim()
  if (!ADDRESS.test(address) || address.length > 320) return null
  const name = named?.[1]?.trim().replace(/^"(.*)"$/, "$1")
  return name ? { name, address } : { address }
}

/** The mailbox as SES takes it: a display name outside printable ASCII is
    MIME-encoded (RFC 2047), and a quoted one is escaped. */
export function sesMailbox(value: string) {
  const mailbox = parseMailbox(value)
  if (!mailbox?.name) return mailbox?.address ?? value
  const name = /^[\x20-\x7e]*$/.test(mailbox.name)
    ? `"${mailbox.name.replace(/["\\]/g, "\\$&")}"`
    : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(mailbox.name)))}?=`
  return `${name} <${mailbox.address}>`
}

/** Resend's `scheduled_at`: ISO 8601, or natural language ("in 1 min",
    "tomorrow at 9am", "Friday at 3pm ET"). Null when it names no time. */
export function parseScheduledAt(value: string, now: number): number | null {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const at = Date.parse(text)
    return Number.isFinite(at) ? at : null
  }
  return parseSchedule(text, now)
}

/** The address part, lowercased: how suppressions and history match. */
export const addressKey = (mailbox: Mailbox) => mailbox.address.toLowerCase()

export const senderDomainOf = (mailbox: Mailbox) =>
  mailbox.address.slice(mailbox.address.lastIndexOf("@") + 1).toLowerCase()

/** Words a search index can match: addresses also split at their dots. */
export function searchWords(...values: string[]) {
  return values
    .flatMap((value) => [value, value.replace(/[@._+<>"-]+/g, " ")])
    .join(" ")
}

/** SES's message tag rule, which Resend repeats for `tags`. */
export const TAG_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

/** Headers SES builds from the request's own fields. */
const RESERVED_HEADERS = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "reply-to",
  "sender",
  "return-path",
  "content-type",
  "content-transfer-encoding",
  "content-disposition",
  "mime-version",
  "message-id",
  "date",
])

/** SES's MessageHeader rules, or null when the header can be sent. */
export function headerError(name: string, value: string): string | null {
  if (!/^[\x21-\x39\x3b-\x7e]{1,126}$/.test(name))
    return `The header name \`${name}\` is not valid.`
  if (RESERVED_HEADERS.has(name.toLowerCase()))
    return `The \`${name}\` header is set from the request's own fields.`
  if (!/^[\x20-\x7e]{0,995}$/.test(value) || name.length + value.length > 996)
    return `The value of the \`${name}\` header is not valid.`
  return null
}

/* Extensions SES refuses to send:
   https://docs.aws.amazon.com/ses/latest/dg/mime-types.html */
const BLOCKED_EXTENSIONS = new Set(
  (
    "ade adp app asp bas bat cer chm cmd com cpl crt csh der exe fxp gadget " +
    "hlp hta inf ins isp its js jse ksh lib lnk mad maf mag mam maq mar mas " +
    "mat mau mav maw mda mdb mde mdt mdw mdz msc msh msh1 msh2 mshxml " +
    "msh1xml msh2xml msi msp mst ops pcd pif plg prf prg reg scf scr sct shb " +
    "shs sys ps1 ps1xml ps2 ps2xml psc1 psc2 tmp url vb vbe vbs vps " +
    "vsmacros vss vst vsw vxd ws wsc wsf wsh xnk"
  ).split(" ")
)
const extension = (filename: string) =>
  filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : ""

export function attachmentNameError(filename: string): string | null {
  if (!filename.trim() || filename.length > 255 || /[\r\n"\\/]/.test(filename))
    return `The attachment filename \`${filename}\` is not valid.`
  if (BLOCKED_EXTENSIONS.has(extension(filename)))
    return `Attachments of type .${extension(filename)} cannot be sent.`
  return null
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
  html: "text/html",
  ics: "text/calendar",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
/** Derived from the filename when the request names none, as Resend does. */
export const attachmentContentType = (filename: string) =>
  CONTENT_TYPES[extension(filename)] ?? "application/octet-stream"

/** Resend's `template.variables` rules. */
export function templateVariableError(
  key: string,
  value: unknown
): string | null {
  if (!/^[A-Za-z0-9_]{1,50}$/.test(key))
    return `The template variable \`${key}\` is not a valid name.`
  const ok =
    typeof value === "string"
      ? value.length <= 2000
      : typeof value === "number" &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER
  if (!ok)
    return `The template variable \`${key}\` must be a string of at most 2000 characters or a number.`
  return null
}
