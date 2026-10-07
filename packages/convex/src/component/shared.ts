import { v, type Infer } from "convex/values"

export const MAX_EMAIL_BYTES = 64 * 1024
export const vStatus = v.union(
  v.literal("queued"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("delivery_delayed"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("failed")
)
export type Status = Infer<typeof vStatus>
export const vTemplate = v.object({
  id: v.string(),
  variables: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
})
export const vAttachment = v.object({
  id: v.optional(v.string()),
  content: v.optional(v.string()),
  path: v.optional(v.string()),
  filename: v.optional(v.string()),
  contentType: v.optional(v.string()),
  contentId: v.optional(v.string()),
})
export const vEmail = v.object({
  from: v.optional(v.string()),
  to: v.array(v.string()),
  cc: v.optional(v.array(v.string())),
  bcc: v.optional(v.array(v.string())),
  replyTo: v.optional(v.array(v.string())),
  subject: v.optional(v.string()),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
  template: v.optional(vTemplate),
  headers: v.optional(v.record(v.string(), v.string())),
  tags: v.optional(v.array(v.object({ name: v.string(), value: v.string() }))),
  scheduledAt: v.optional(v.string()),
  topicId: v.optional(v.string()),
  attachments: v.optional(v.array(vAttachment)),
})
export type Email = Infer<typeof vEmail>
export const vDelivery = v.object({
  apiKey: v.string(),
  baseUrl: v.string(),
  maxAttempts: v.number(),
  initialBackoffMs: v.number(),
})
export const vEmailEventType = v.union(
  v.literal("email.sent"),
  v.literal("email.delivery_delayed"),
  v.literal("email.delivered"),
  v.literal("email.bounced"),
  v.literal("email.failed"),
  v.literal("email.suppressed"),
  v.literal("email.complained"),
  v.literal("email.opened"),
  v.literal("email.clicked")
)
export const vEmailEvent = v.object({
  type: vEmailEventType,
  opensendId: v.string(),
  message: v.optional(v.string()),
  componentEmailId: v.optional(v.string()),
})
export type EmailEvent = Infer<typeof vEmailEvent>
export const vEmailStatus = v.object({
  status: vStatus,
  opensendId: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  opened: v.boolean(),
  clicked: v.boolean(),
  complained: v.boolean(),
})
export type EmailStatus = Infer<typeof vEmailStatus>
export const vOnEmailEventArgs = v.object({
  id: v.string(),
  event: vEmailEvent,
})

export function validateEmail(email: Email) {
  if (!email.html && !email.text && !email.template?.id)
    throw new Error("OpenSend needs html, text, or template.")
  if (email.template && (email.html !== undefined || email.text !== undefined))
    throw new Error("OpenSend template cannot be combined with html or text.")
  if (!email.template && (!email.from || !email.subject))
    throw new Error("OpenSend needs from and subject without a template.")
  if ((email.tags?.length ?? 0) > 47)
    throw new Error(
      "OpenSend accepts at most 47 caller tags (one tag is reserved)."
    )
  if (email.tags?.some((tag) => tag.name === "opensend_component_email"))
    throw new Error(
      "OpenSend reserves the opensend_component_email tag for webhook correlation."
    )
  if (
    new TextEncoder().encode(JSON.stringify(email)).byteLength > MAX_EMAIL_BYTES
  )
    throw new Error(
      "OpenSend email input must fit within 64 KiB (including attachments)."
    )
}

export function validateDelivery(delivery: Infer<typeof vDelivery>) {
  if (!delivery.apiKey || !delivery.baseUrl)
    throw new Error("OpenSend needs apiKey and baseUrl to send email.")
  const url = new URL(delivery.baseUrl)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "OpenSend baseUrl must be an HTTP(S) URL without credentials."
    )
  if (
    !Number.isInteger(delivery.maxAttempts) ||
    delivery.maxAttempts < 1 ||
    delivery.maxAttempts > 20
  )
    throw new Error("OpenSend maxAttempts must be an integer between 1 and 20.")
  if (
    !Number.isFinite(delivery.initialBackoffMs) ||
    delivery.initialBackoffMs < 0
  )
    throw new Error("OpenSend initialBackoffMs must be finite and nonnegative.")
}

export const vDeliverResult = v.union(
  v.object({ sent: v.literal(true), opensendId: v.string() }),
  v.object({ sent: v.literal(false), error: v.string() })
)
