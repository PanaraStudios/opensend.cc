import {
  BulkEmailStatus,
  SESv2Client,
  SESv2ServiceException,
  SendBulkEmailCommand,
  SendEmailCommand,
  type BulkEmailEntry,
  type MessageHeader,
  type MessageTag,
  type SendBulkEmailCommandInput,
  type SendEmailCommandInput,
  type Template as SesTemplate,
} from "@aws-sdk/client-sesv2"
import type { Credentials, NameValue, Template } from "./shared.js"
import { SES_EMAIL_ID_TAG } from "./shared.js"
import { stableStringify } from "./utils.js"

/** SESv2 `SendBulkEmail` accepts at most 50 destinations per call. */
export const MAX_BULK_ENTRIES = 50

/** Everything needed to hand an email to SES, independent of storage. */
export type OutboundEmail<Id extends string = string> = {
  id: Id
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  replyTo: string[]
  html?: string
  text?: string
  template?: Template
  headers?: NameValue[]
  tags?: NameValue[]
  configurationSetName?: string
}

export type SesClientConfig = {
  region: string
  credentials: Credentials
  /** Passed to the SDK's built-in standard retry strategy. */
  maxAttempts?: number
}

export function createSesClient(config: SesClientConfig): SESv2Client {
  return new SESv2Client({
    region: config.region,
    credentials: config.credentials,
    // The durable workpool owns retries and quota accounting. Hidden SDK
    // retries can duplicate accepted sends when a response is lost.
    maxAttempts: config.maxAttempts ?? 1,
  })
}

/* ------------------------------------------------------------------------ */
/* Request building                                                          */
/* ------------------------------------------------------------------------ */

const toMessageHeaders = (
  headers: NameValue[] | undefined
): MessageHeader[] | undefined =>
  headers?.length
    ? headers.map((h) => ({ Name: h.name, Value: h.value }))
    : undefined

const toMessageTags = (
  tags: NameValue[] | undefined
): MessageTag[] | undefined =>
  tags?.length ? tags.map((t) => ({ Name: t.name, Value: t.value })) : undefined

const nonEmpty = (list: string[] | undefined): string[] | undefined =>
  list?.length ? list : undefined

/** Serialize template data to the `TemplateData` JSON string SES expects. */
export const serializeTemplateData = (
  data: Record<string, unknown> | undefined
): string => JSON.stringify(data ?? {})

function toSesTemplate(
  template: Template,
  headers: NameValue[] | undefined
): SesTemplate {
  return {
    TemplateName: template.name,
    TemplateArn: template.arn,
    TemplateContent: template.content
      ? {
          Subject: template.content.subject,
          Html: template.content.html,
          Text: template.content.text,
        }
      : undefined,
    TemplateData: serializeTemplateData(template.data),
    Headers: toMessageHeaders(headers),
  }
}

/** Build the SESv2 `SendEmail` input for a single email. */
export function buildSendEmailInput(
  email: OutboundEmail
): SendEmailCommandInput {
  const content: SendEmailCommandInput["Content"] = email.template
    ? { Template: toSesTemplate(email.template, email.headers) }
    : {
        Simple: {
          Subject: { Data: email.subject ?? "", Charset: "UTF-8" },
          Body: {
            Html:
              email.html !== undefined
                ? { Data: email.html, Charset: "UTF-8" }
                : undefined,
            Text:
              email.text !== undefined
                ? { Data: email.text, Charset: "UTF-8" }
                : undefined,
          },
          Headers: toMessageHeaders(email.headers),
        },
      }

  return {
    FromEmailAddress: email.from,
    Destination: {
      ToAddresses: email.to,
      CcAddresses: nonEmpty(email.cc),
      BccAddresses: nonEmpty(email.bcc),
    },
    ReplyToAddresses: nonEmpty(email.replyTo),
    Content: content,
    EmailTags: toMessageTags([
      { name: SES_EMAIL_ID_TAG, value: email.id },
      ...(email.tags ?? []),
    ]),
    ConfigurationSetName: email.configurationSetName,
  }
}

/**
 * Templated emails can share one `SendBulkEmail` call when they use the same
 * sender, reply-to addresses, configuration set, and template identity.
 * Everything else (destination, template data, headers, tags) is a per-entry
 * replacement.
 */
export function bulkGroupKey(email: OutboundEmail): string {
  const template = email.template
  return stableStringify({
    from: email.from,
    replyTo: email.replyTo,
    configurationSetName: email.configurationSetName,
    template: template
      ? { name: template.name, arn: template.arn, content: template.content }
      : undefined,
  })
}

/** Build the SESv2 `SendBulkEmail` input for a group of compatible templated emails. */
export function buildSendBulkEmailInput(
  emails: OutboundEmail[]
): SendBulkEmailCommandInput {
  const [first] = emails
  if (!first?.template) {
    throw new Error("SendBulkEmail requires templated emails")
  }
  if (emails.length > MAX_BULK_ENTRIES) {
    throw new Error(
      `SendBulkEmail accepts at most ${MAX_BULK_ENTRIES} entries, got ${emails.length}`
    )
  }
  return {
    FromEmailAddress: first.from,
    ReplyToAddresses: nonEmpty(first.replyTo),
    ConfigurationSetName: first.configurationSetName,
    // The template identity is shared; per-entry data and headers are replacements.
    DefaultContent: {
      Template: toSesTemplate({ ...first.template, data: {} }, undefined),
    },
    BulkEmailEntries: emails.map((email): BulkEmailEntry => ({
      Destination: {
        ToAddresses: email.to,
        CcAddresses: nonEmpty(email.cc),
        BccAddresses: nonEmpty(email.bcc),
      },
      ReplacementEmailContent: {
        ReplacementTemplate: {
          ReplacementTemplateData:
            serializeTemplateData(email.template?.data) ?? "{}",
        },
      },
      ReplacementHeaders: toMessageHeaders(email.headers),
      ReplacementTags: toMessageTags([
        { name: SES_EMAIL_ID_TAG, value: email.id },
        ...(email.tags ?? []),
      ]),
    })),
  }
}

/* ------------------------------------------------------------------------ */
/* Batch planning                                                            */
/* ------------------------------------------------------------------------ */

export type SendUnit<Id extends string = string> =
  | { kind: "single"; email: OutboundEmail<Id> }
  | { kind: "bulk"; emails: OutboundEmail<Id>[] }

/**
 * Plan API calls for a batch: non-templated emails each need a `SendEmail`
 * call; templated emails are grouped into `SendBulkEmail` calls of up to 50.
 * Groups of one fall back to `SendEmail` to keep the request simpler.
 */
export function planSendUnits<Id extends string>(
  emails: OutboundEmail<Id>[],
  maxBulkRecipients = MAX_BULK_ENTRIES
): SendUnit<Id>[] {
  const units: SendUnit<Id>[] = []
  const groups = new Map<string, OutboundEmail<Id>[]>()

  for (const email of emails) {
    if (!email.template) {
      units.push({ kind: "single", email })
      continue
    }
    const key = bulkGroupKey(email)
    const group = groups.get(key)
    if (group) group.push(email)
    else groups.set(key, [email])
  }

  for (const group of groups.values()) {
    const parts: OutboundEmail<Id>[][] = []
    let part: OutboundEmail<Id>[] = []
    let count = 0
    for (const email of group) {
      const recipients = unitRecipientCount({ kind: "single", email })
      if (
        part.length &&
        (part.length === MAX_BULK_ENTRIES ||
          count + recipients > maxBulkRecipients)
      ) {
        parts.push(part)
        part = []
        count = 0
      }
      part.push(email)
      count += recipients
    }
    if (part.length) parts.push(part)
    for (const part of parts) {
      const [only] = part
      if (part.length === 1 && only) units.push({ kind: "single", email: only })
      else units.push({ kind: "bulk", emails: part })
    }
  }
  return units
}

/** Number of recipients a unit will deliver to; SES counts each against your quota. */
export function unitRecipientCount(unit: SendUnit): number {
  const emails = unit.kind === "single" ? [unit.email] : unit.emails
  return emails.reduce(
    (n, e) => n + e.to.length + (e.cc?.length ?? 0) + (e.bcc?.length ?? 0),
    0
  )
}

/* ------------------------------------------------------------------------ */
/* Error classification                                                      */
/* ------------------------------------------------------------------------ */

export type FailureKind = "transient" | "permanent"

/**
 * SESv2 exceptions that will not succeed on retry. Everything else (throttling,
 * service errors, network failures) is treated as transient and retried by the
 * workpool with exponential backoff.
 */
const PERMANENT_EXCEPTIONS = new Set([
  "AccountSuspendedException",
  "BadRequestException",
  "MailFromDomainNotVerifiedException",
  "MessageRejected",
  "NotFoundException",
  "SendingPausedException",
])

export function classifySesError(error: unknown): FailureKind {
  if (error instanceof SESv2ServiceException) {
    if (PERMANENT_EXCEPTIONS.has(error.name)) return "permanent"
    return "transient"
  }
  if (error instanceof Error && PERMANENT_EXCEPTIONS.has(error.name)) {
    return "permanent"
  }
  return "transient"
}

const TRANSIENT_BULK_STATUSES = new Set<string>([
  BulkEmailStatus.ACCOUNT_THROTTLED,
  BulkEmailStatus.TRANSIENT_FAILURE,
  BulkEmailStatus.FAILED,
])

export function classifyBulkStatus(
  status: string | undefined
): "success" | FailureKind {
  if (status === BulkEmailStatus.SUCCESS) return "success"
  if (status === undefined || TRANSIENT_BULK_STATUSES.has(status)) {
    return "transient"
  }
  return "permanent"
}

/* ------------------------------------------------------------------------ */
/* Sending                                                                   */
/* ------------------------------------------------------------------------ */

export type SentResult<Id extends string> = { emailId: Id; messageId: string }
export type FailedResult<Id extends string> = { emailId: Id; error: string }

export type UnitOutcome<Id extends string> = {
  sent: SentResult<Id>[]
  failed: FailedResult<Id>[]
  /** Emails that hit a transient failure and should be retried later. */
  retry: Id[]
}

export class TransientSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TransientSendError"
  }
}

/**
 * Send one unit. Permanent failures are reported in `failed`; transient
 * failures throw a {@link TransientSendError} (single) or are reported in
 * `retry` (bulk, where other entries may have succeeded).
 */
export async function sendUnit<Id extends string>(
  client: SESv2Client,
  unit: SendUnit<Id>
): Promise<UnitOutcome<Id>> {
  if (unit.kind === "single") {
    return sendSingle(client, unit.email)
  }
  return sendBulk(client, unit.emails)
}

async function sendSingle<Id extends string>(
  client: SESv2Client,
  email: OutboundEmail<Id>
): Promise<UnitOutcome<Id>> {
  try {
    const response = await client.send(
      new SendEmailCommand(buildSendEmailInput(email))
    )
    if (!response.MessageId) {
      throw new TransientSendError("SES SendEmail returned no MessageId")
    }
    return {
      sent: [{ emailId: email.id, messageId: response.MessageId }],
      failed: [],
      retry: [],
    }
  } catch (error) {
    const message = describeSesError(error)
    if (classifySesError(error) === "permanent") {
      return {
        sent: [],
        failed: [{ emailId: email.id, error: message }],
        retry: [],
      }
    }
    throw new TransientSendError(message)
  }
}

async function sendBulk<Id extends string>(
  client: SESv2Client,
  emails: OutboundEmail<Id>[]
): Promise<UnitOutcome<Id>> {
  let results
  try {
    const response = await client.send(
      new SendBulkEmailCommand(buildSendBulkEmailInput(emails))
    )
    results = response.BulkEmailEntryResults ?? []
  } catch (error) {
    const message = describeSesError(error)
    if (classifySesError(error) === "permanent") {
      return {
        sent: [],
        failed: emails.map((e) => ({ emailId: e.id, error: message })),
        retry: [],
      }
    }
    throw new TransientSendError(message)
  }

  const outcome: UnitOutcome<Id> = { sent: [], failed: [], retry: [] }
  emails.forEach((email, i) => {
    const result = results[i]
    const kind = classifyBulkStatus(result?.Status)
    if (kind === "success" && result?.MessageId) {
      outcome.sent.push({ emailId: email.id, messageId: result.MessageId })
    } else if (kind === "permanent") {
      outcome.failed.push({
        emailId: email.id,
        error: `SES SendBulkEmail ${result?.Status}: ${result?.Error ?? "no details"}`,
      })
    } else {
      outcome.retry.push(email.id)
    }
  })
  return outcome
}

export function describeSesError(error: unknown): string {
  if (error instanceof SESv2ServiceException) {
    const status = error.$metadata.httpStatusCode
    return `SES ${error.name}${status ? ` (HTTP ${status})` : ""}: ${error.message}`
  }
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}
