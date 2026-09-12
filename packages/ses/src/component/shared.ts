import { literals } from "convex-helpers/validators"
import {
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server"
import { type Infer, v } from "convex/values"

/** Validator for the `onEmailEvent` callback option (a function handle). */
export const vOnEmailEvent = v.object({
  fnHandle: v.string(),
})

/** Lifecycle status of an email tracked by the component. */
export const vStatus = v.union(
  literals(
    "waiting",
    "queued",
    "cancelled",
    "sent",
    "delivered",
    "delivery_delayed",
    "bounced",
    "failed"
  )
)
export type Status = Infer<typeof vStatus>

/** A `{ name, value }` pair, used for both message headers and SES message tags. */
export const vNameValue = v.object({
  name: v.string(),
  value: v.string(),
})
export type NameValue = Infer<typeof vNameValue>
export const SES_EMAIL_ID_TAG = "convex-email-id"

/**
 * Inline template content, mirroring SESv2 `EmailTemplateContent`.
 * Subject, HTML, and text all support Handlebars-style `{{variables}}`.
 */
export const vTemplateContent = v.object({
  subject: v.optional(v.string()),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
})
export type TemplateContent = Infer<typeof vTemplateContent>

/**
 * A reference to an SES template. Exactly one of `name`, `arn`, or `content`
 * must be provided. `data` is the template data object that SES renders the
 * template with (serialized to the `TemplateData` JSON string).
 */
export const vTemplate = v.object({
  name: v.optional(v.string()),
  arn: v.optional(v.string()),
  content: v.optional(vTemplateContent),
  data: v.optional(v.record(v.string(), v.any())),
})
export type Template = Infer<typeof vTemplate>

/** Static AWS credentials used to sign SESv2 API requests. */
export const vCredentials = v.object({
  accessKeyId: v.string(),
  secretAccessKey: v.string(),
  sessionToken: v.optional(v.string()),
})
export type Credentials = Infer<typeof vCredentials>

/** Runtime options persisted by the component so background workers can use them. */
export const vOptions = v.object({
  region: v.string(),
  credentials: vCredentials,
  maxSendRate: v.number(),
  initialBackoffMs: v.number(),
  retryAttempts: v.number(),
  testMode: v.boolean(),
  configurationSetName: v.optional(v.string()),
  onEmailEvent: v.optional(vOnEmailEvent),
})
export type RuntimeConfig = Infer<typeof vOptions>

/* ------------------------------------------------------------------------ */
/* Amazon SES event publishing records                                       */
/* https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html */
/* ------------------------------------------------------------------------ */

const vStringList = v.array(v.string())

/** The `mail` object present on every SES event record. */
export const vMail = v.object({
  timestamp: v.string(),
  /** The message ID that Amazon SES assigned; returned from `SendEmail`. */
  messageId: v.string(),
  source: v.optional(v.string()),
  sourceArn: v.optional(v.string()),
  sendingAccountId: v.optional(v.string()),
  destination: v.optional(vStringList),
  headersTruncated: v.optional(v.boolean()),
  headers: v.optional(v.array(vNameValue)),
  commonHeaders: v.optional(
    v.object({
      from: v.optional(vStringList),
      to: v.optional(vStringList),
      cc: v.optional(vStringList),
      bcc: v.optional(vStringList),
      replyTo: v.optional(vStringList),
      sender: v.optional(vStringList),
      returnPath: v.optional(v.string()),
      date: v.optional(v.string()),
      messageId: v.optional(v.string()),
      subject: v.optional(v.string()),
    })
  ),
  tags: v.optional(v.record(v.string(), vStringList)),
})

const vBouncedRecipient = v.object({
  emailAddress: v.string(),
  action: v.optional(v.string()),
  status: v.optional(v.string()),
  diagnosticCode: v.optional(v.string()),
})

const vBounce = v.object({
  bounceType: v.string(),
  bounceSubType: v.string(),
  bouncedRecipients: v.array(vBouncedRecipient),
  timestamp: v.string(),
  feedbackId: v.string(),
  reportingMTA: v.optional(v.string()),
})

const vComplaint = v.object({
  complainedRecipients: v.array(v.object({ emailAddress: v.string() })),
  timestamp: v.string(),
  feedbackId: v.string(),
  complaintSubType: v.optional(v.union(v.string(), v.null())),
  userAgent: v.optional(v.string()),
  complaintFeedbackType: v.optional(v.string()),
  arrivalDate: v.optional(v.string()),
})

const vDelivery = v.object({
  timestamp: v.string(),
  processingTimeMillis: v.optional(v.number()),
  recipients: vStringList,
  smtpResponse: v.optional(v.string()),
  reportingMTA: v.optional(v.string()),
  remoteMtaIp: v.optional(v.string()),
})

const vReject = v.object({
  reason: v.string(),
})

const vOpen = v.object({
  ipAddress: v.optional(v.string()),
  timestamp: v.string(),
  userAgent: v.optional(v.string()),
  isBotEvent: v.optional(v.string()),
})

const vClick = v.object({
  ipAddress: v.optional(v.string()),
  timestamp: v.string(),
  userAgent: v.optional(v.string()),
  link: v.string(),
  linkTags: v.optional(v.record(v.string(), vStringList)),
  isBotEvent: v.optional(v.string()),
})

const vRenderingFailure = v.object({
  templateName: v.optional(v.string()),
  errorMessage: v.string(),
})

const vDeliveryDelay = v.object({
  delayType: v.string(),
  delayedRecipients: v.optional(
    v.array(
      v.object({
        emailAddress: v.string(),
        status: v.optional(v.string()),
        diagnosticCode: v.optional(v.string()),
      })
    )
  ),
  expirationTime: v.optional(v.string()),
  reportingMTA: v.optional(v.string()),
  timestamp: v.string(),
})

const vTopicPreferences = v.object({
  unsubscribeAll: v.optional(v.boolean()),
  topicSubscriptionStatus: v.optional(
    v.array(
      v.object({
        topicName: v.string(),
        subscriptionStatus: v.string(),
      })
    )
  ),
  topicDefaultSubscriptionStatus: v.optional(
    v.array(
      v.object({
        topicName: v.string(),
        subscriptionStatus: v.string(),
      })
    )
  ),
})

const vSubscription = v.object({
  contactList: v.optional(v.string()),
  timestamp: v.string(),
  source: v.optional(v.string()),
  newTopicPreferences: v.optional(vTopicPreferences),
  oldTopicPreferences: v.optional(vTopicPreferences),
})

/**
 * All SES event types this component understands. The values match the
 * `eventType` field published by SES exactly (note "Rendering Failure").
 */
export const ACCEPTED_EVENT_TYPES = [
  "Send",
  "Reject",
  "Bounce",
  "Complaint",
  "Delivery",
  "Open",
  "Click",
  "Rendering Failure",
  "DeliveryDelay",
  "Subscription",
] as const

export const vEventType = v.union(literals(...ACCEPTED_EVENT_TYPES))
export type EventType = Infer<typeof vEventType>

/**
 * Normalized SES event record. The discriminant is `eventType`; feedback
 * notifications that use `notificationType` are normalized before parsing.
 */
export const vEmailEvent = v.union(
  v.object({
    eventType: v.literal("Send"),
    mail: vMail,
    send: v.optional(v.object({})),
  }),
  v.object({ eventType: v.literal("Reject"), mail: vMail, reject: vReject }),
  v.object({ eventType: v.literal("Bounce"), mail: vMail, bounce: vBounce }),
  v.object({
    eventType: v.literal("Complaint"),
    mail: vMail,
    complaint: vComplaint,
  }),
  v.object({
    eventType: v.literal("Delivery"),
    mail: vMail,
    delivery: vDelivery,
  }),
  v.object({ eventType: v.literal("Open"), mail: vMail, open: vOpen }),
  v.object({ eventType: v.literal("Click"), mail: vMail, click: vClick }),
  v.object({
    eventType: v.literal("Rendering Failure"),
    mail: vMail,
    failure: vRenderingFailure,
  }),
  v.object({
    eventType: v.literal("DeliveryDelay"),
    mail: vMail,
    deliveryDelay: vDeliveryDelay,
  }),
  v.object({
    eventType: v.literal("Subscription"),
    mail: vMail,
    subscription: vSubscription,
  })
)

export type EmailEvent = Infer<typeof vEmailEvent>
export type EmailEventOfType<T extends EventType> = Extract<
  EmailEvent,
  { eventType: T }
>

/* Type utils follow */

export type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">
export type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>
