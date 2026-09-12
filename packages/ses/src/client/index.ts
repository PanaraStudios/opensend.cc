import {
  createFunctionHandle,
  internalMutationGeneric,
  type FunctionReference,
  type FunctionVisibility,
  type GenericDataModel,
  type GenericMutationCtx,
} from "convex/server"
import { v, type VString } from "convex/values"
import {
  vEmailEvent,
  type ActionCtx,
  type Credentials,
  type EmailEvent,
  type MutationCtx,
  type NameValue,
  type QueryCtx,
  type RuntimeConfig,
  type Status,
  type Template,
} from "../component/shared.js"
import type { ComponentApi } from "../component/_generated/component.js"
import { assertTuning, errorMessage, toArray } from "../component/utils.js"
import {
  isTrustedSnsUrl,
  parseSnsMessage,
  readLimitedBody,
  SnsVerificationError,
  verifySnsMessage,
  type CertificateFetcher,
} from "./sns.js"

export type SESComponent = ComponentApi

/** Branded id of an email tracked by the component. */
export type EmailId = string & { __isEmailId: true }
export const vEmailId = v.string() as VString<EmailId>

export {
  vEmailEvent,
  vEventType,
  vOptions,
  vStatus,
  vTemplate,
  vTemplateContent,
  vNameValue,
} from "../component/shared.js"
export type {
  Credentials,
  EmailEvent,
  EmailEventOfType,
  EventType,
  NameValue,
  Status,
  Template,
  TemplateContent,
} from "../component/shared.js"
export {
  SnsVerificationError,
  parseSnsMessage,
  verifySnsMessage,
  type SnsMessage,
} from "./sns.js"

/** Args validator for your `onEmailEvent` mutation. */
export const vOnEmailEventArgs = v.object({
  id: vEmailId,
  event: vEmailEvent,
})

type OnEmailEventRef = FunctionReference<
  "mutation",
  FunctionVisibility,
  { id: EmailId; event: EmailEvent }
>

type Config = Omit<RuntimeConfig, "onEmailEvent"> & {
  snsTopicArns: string[]
}

const DEFAULT_MAX_SEND_RATE = 1 // The Amazon SES sandbox limit.
const DEFAULT_INITIAL_BACKOFF_MS = 30_000
const DEFAULT_RETRY_ATTEMPTS = 5

function getDefaultConfig(): Config {
  const env = process.env
  const topicArn = env.AWS_SES_SNS_TOPIC_ARN ?? ""
  return {
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "",
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
      sessionToken: env.AWS_SESSION_TOKEN || undefined,
    },
    snsTopicArns: topicArn ? topicArn.split(",").map((s) => s.trim()) : [],
    configurationSetName: env.AWS_SES_CONFIGURATION_SET || undefined,
    maxSendRate: env.AWS_SES_MAX_SEND_RATE
      ? Number(env.AWS_SES_MAX_SEND_RATE)
      : DEFAULT_MAX_SEND_RATE,
    initialBackoffMs: DEFAULT_INITIAL_BACKOFF_MS,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
    testMode: true,
  }
}

export type SESOptions = {
  /**
   * The AWS region your SES identities live in, e.g. `us-east-1`.
   * If not provided, it is read from the `AWS_REGION` (or `AWS_DEFAULT_REGION`)
   * environment variable.
   */
  region?: string

  /**
   * Static credentials for an IAM principal allowed to call `ses:SendEmail` and
   * `ses:SendBulkEmail`. If not provided, they are read from `AWS_ACCESS_KEY_ID`,
   * `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN`.
   */
  credentials?: Credentials

  /**
   * The ARN(s) of the SNS topic(s) your SES configuration set publishes events
   * to. Messages from any other topic are rejected by the webhook handler.
   * If not provided, read from `AWS_SES_SNS_TOPIC_ARN` (comma-separated).
   */
  snsTopicArn?: string | string[]

  /**
   * The SES configuration set to send with by default. Event publishing
   * (delivery, bounce, complaint, open, click, ...) is configured per
   * configuration set. If not provided, read from `AWS_SES_CONFIGURATION_SET`.
   */
  configurationSetName?: string

  /**
   * Your account's SES maximum send rate, in emails per second. The component
   * paces API calls to stay under it. Defaults to 1 (the sandbox limit); find
   * yours in the SES console under "Account dashboard".
   */
  maxSendRate?: number

  /**
   * The initial backoff to use when retrying a failed SES API call.
   * If not provided, the initial backoff will be 30 seconds.
   */
  initialBackoffMs?: number

  /**
   * The number of retry attempts for a failed SES API call.
   * If not provided, the number of retry attempts will be 5.
   */
  retryAttempts?: number

  /**
   * Whether to run in test mode. In test mode, only emails to Amazon SES
   * mailbox simulator addresses (e.g. `success@simulator.amazonses.com`) are
   * allowed. Defaults to true; you need to opt into production mode by
   * setting testMode to false.
   */
  testMode?: boolean

  /**
   * A mutation to run after an email event occurs.
   * The mutation will be passed the email id and the event.
   */
  onEmailEvent?: OnEmailEventRef | null
}

async function configToRuntimeConfig(
  config: Config,
  onEmailEvent?: OnEmailEventRef | null
): Promise<RuntimeConfig> {
  return {
    region: config.region,
    credentials: config.credentials,
    configurationSetName: config.configurationSetName,
    maxSendRate: config.maxSendRate,
    initialBackoffMs: config.initialBackoffMs,
    retryAttempts: config.retryAttempts,
    testMode: config.testMode,
    onEmailEvent: onEmailEvent
      ? { fnHandle: await createFunctionHandle(onEmailEvent) }
      : undefined,
  }
}

export type EmailStatus = {
  /**
   * The status of the email. It will be one of the following:
   * - `waiting`: The email has not yet been batched.
   * - `queued`: The email has been batched and is waiting to be sent.
   * - `cancelled`: The email has been cancelled.
   * - `sent`: Amazon SES accepted the email, but we do not yet know its fate.
   * - `bounced`: The email bounced.
   * - `delivered`: The email was delivered successfully.
   * - `delivery_delayed`: Amazon SES is having trouble delivering the email, but is still trying.
   * - `failed`: The email could not be sent, was rejected, or failed to render.
   */
  status: Status

  /** The error message of the email. Typically only set on bounces and failures. */
  errorMessage: string | null

  /** The message ID Amazon SES assigned once it accepted the email. */
  sesMessageId: string | null

  /** Whether the email bounced. */
  bounced: boolean

  /** Whether the recipient marked the email as spam. */
  complained: boolean

  /** Whether the email failed to send, was rejected, or failed to render. */
  failed: boolean

  /** Whether the email delivery was delayed. */
  deliveryDelayed: boolean

  /** If you're using open tracking, did Amazon SES detect that the email was opened? */
  opened: boolean

  /** If you're using click tracking, did Amazon SES detect that a link was clicked? */
  clicked: boolean
}

type SendEmailBase = {
  from: string
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string | string[]
  /** Custom message headers. */
  headers?: NameValue[]
  /** SES message tags, published with every event for this email. */
  tags?: NameValue[]
  /** Override the component's default configuration set for this email. */
  configurationSetName?: string
  /**
   * An optional caller-supplied key that dedupes enqueues. If an email with
   * this key has already been enqueued, `sendEmail` returns the existing
   * {@link EmailId} instead of enqueueing (and delivering) a duplicate.
   */
  idempotencyKey?: string
}

export type SendEmailOptions =
  | (SendEmailBase & {
      subject: string
      html?: string
      text?: string
      template?: never
    })
  | (SendEmailBase & {
      /** The template renders the subject; SES ignores a separate subject. */
      subject?: string
      template:
        Template | { id: string; variables?: Record<string, string | number> }
      html?: never
      text?: never
    })

export type SendEmailManuallyOptions = {
  from: string
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject: string
  replyTo?: string[]
  headers?: NameValue[]
  tags?: NameValue[]
  configurationSetName?: string
}

export type EmailDetails = {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  replyTo: string[]
  headers?: NameValue[]
  tags?: NameValue[]
  configurationSetName?: string
  status: Status
  errorMessage?: string
  bounced: boolean
  complained: boolean
  failed: boolean
  deliveryDelayed: boolean
  opened: boolean
  clicked: boolean
  sesMessageId?: string
  idempotencyKey?: string
  segment: number
  finalizedAt: number
  createdAt: number
  html?: string
  text?: string
  template?: Template
}

export class SES {
  public config: Config
  onEmailEvent?: OnEmailEventRef | null
  private readonly fetchCertificate: CertificateFetcher | undefined

  /**
   * Creates an Amazon SES component client.
   *
   * @param component The component to use, like `components.ses` from
   * `./_generated/api.ts`.
   * @param options The {@link SESOptions} to use for this component.
   */
  constructor(
    public component: ComponentApi,
    options?: SESOptions & {
      /** @internal Override signing certificate retrieval; used by tests. */
      fetchCertificate?: CertificateFetcher
    }
  ) {
    const defaults = getDefaultConfig()
    this.config = {
      region: options?.region ?? defaults.region,
      credentials: options?.credentials ?? defaults.credentials,
      snsTopicArns: toArray(options?.snsTopicArn) ?? defaults.snsTopicArns,
      configurationSetName:
        options?.configurationSetName ?? defaults.configurationSetName,
      maxSendRate: options?.maxSendRate ?? defaults.maxSendRate,
      initialBackoffMs: options?.initialBackoffMs ?? defaults.initialBackoffMs,
      retryAttempts: options?.retryAttempts ?? defaults.retryAttempts,
      testMode: options?.testMode ?? defaults.testMode,
    }
    assertTuning(this.config)
    if (options?.onEmailEvent) {
      this.onEmailEvent = options.onEmailEvent
    }
    this.fetchCertificate = options?.fetchCertificate
  }

  /**
   * Sends an email.
   *
   * Specifically, enqueues your email to be sent as part of efficient, durable
   * batches managed by the component. The email will be sent as soon as
   * possible, but the component will manage rate limiting and batching for you.
   *
   * Amazon SES has no idempotency key, so the component records each accepted
   * response before making the next API call. A lost response or a crash before
   * recording it can cause a duplicate on retry; delivery is not exactly-once.
   *
   * You may also supply an `idempotencyKey` in {@link SendEmailOptions} to dedupe
   * at enqueue time: if an email with the same key has already been enqueued,
   * the existing {@link EmailId} is returned instead of enqueueing a duplicate.
   *
   * @param ctx Any context that can run a mutation. You can enqueue an email from
   * either a mutation or an action.
   * @param options The {@link SendEmailOptions} object containing all email parameters.
   * @returns The id of the email within the component.
   */
  async sendEmail(
    ctx: MutationCtx | ActionCtx,
    options: SendEmailOptions
  ): Promise<EmailId>
  /**
   * Sends an email by providing individual arguments for `from`, `to`,
   * `subject`, and optionally `html`, `text`, `replyTo`, and `headers`.
   *
   * @deprecated Use the object format e.g. `{ from, to, subject, html }`
   */
  async sendEmail(
    ctx: MutationCtx | ActionCtx,
    from: string,
    to: string,
    subject: string,
    html?: string,
    text?: string,
    replyTo?: string[],
    headers?: NameValue[]
  ): Promise<EmailId>
  async sendEmail(
    ctx: MutationCtx | ActionCtx,
    fromOrOptions: string | SendEmailOptions,
    to?: string,
    subject?: string,
    html?: string,
    text?: string,
    replyTo?: string[],
    headers?: NameValue[]
  ): Promise<EmailId> {
    const sendEmailArgs: SendEmailOptions =
      typeof fromOrOptions === "string"
        ? {
            from: fromOrOptions,
            to: to!,
            subject: subject!,
            html,
            text,
            replyTo,
            headers,
          }
        : fromOrOptions

    this.assertCredentials()

    const id = await ctx.runMutation(this.component.lib.sendEmail, {
      ...sendEmailArgs,
      options: await configToRuntimeConfig(this.config, this.onEmailEvent),
      template:
        sendEmailArgs.template && "id" in sendEmailArgs.template
          ? {
              name: sendEmailArgs.template.id,
              data: sendEmailArgs.template.variables,
            }
          : sendEmailArgs.template,
      to: toArray(sendEmailArgs.to) ?? [],
      cc: toArray(sendEmailArgs.cc),
      bcc: toArray(sendEmailArgs.bcc),
      replyTo: toArray(sendEmailArgs.replyTo),
    })
    return id as EmailId
  }

  /**
   * Sends an email yourself while letting the component track it.
   *
   * Use this for anything the batching API does not cover (e.g. attachments
   * via a raw MIME message). The callback receives the {@link EmailId} and must
   * return the `MessageId` Amazon SES responded with, so that SES events can be
   * matched back to this email.
   */
  async sendEmailManually(
    ctx: MutationCtx | ActionCtx,
    options: SendEmailManuallyOptions,
    sendCallback: (emailId: EmailId) => Promise<string>
  ): Promise<EmailId> {
    const emailId = (await ctx.runMutation(
      this.component.lib.createManualEmail,
      {
        testMode: this.config.testMode,
        onEmailEvent: this.onEmailEvent
          ? { fnHandle: await createFunctionHandle(this.onEmailEvent) }
          : undefined,
        from: options.from,
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: options.subject,
        replyTo: options.replyTo,
        headers: options.headers,
        tags: options.tags,
        configurationSetName:
          options.configurationSetName ?? this.config.configurationSetName,
      }
    )) as EmailId
    let sesMessageId: string
    try {
      sesMessageId = await sendCallback(emailId)
      if (!sesMessageId.trim())
        throw new Error("Manual send callback returned an empty SES MessageId")
    } catch (error) {
      await ctx.runMutation(this.component.lib.updateManualEmail, {
        emailId,
        status: "failed",
        errorMessage: errorMessage(error),
      })
      throw error
    }
    // A persistence failure is not a send failure. Do not overwrite an accepted
    // message with failed or erase its provider ID if recording was committed.
    await ctx.runMutation(this.component.lib.updateManualEmail, {
      emailId,
      status: "sent",
      sesMessageId,
    })
    return emailId
  }

  /**
   * Cancels an email.
   *
   * This will mark the email as cancelled if it has not already been handed to
   * Amazon SES.
   *
   * @param ctx Any context that can run a mutation.
   * @param emailId The id of the email to cancel. This was returned from {@link sendEmail}.
   */
  async cancelEmail(
    ctx: MutationCtx | ActionCtx,
    emailId: EmailId
  ): Promise<void> {
    await ctx.runMutation(this.component.lib.cancelEmail, { emailId })
  }

  /**
   * Gets the status of an email.
   *
   * @param ctx Any context that can run a query.
   * @param emailId The id of the email. This was returned from {@link sendEmail}.
   * @returns {@link EmailStatus} The status of the email, or null if unknown.
   */
  async status(
    ctx: QueryCtx | MutationCtx | ActionCtx,
    emailId: EmailId
  ): Promise<EmailStatus | null> {
    return await ctx.runQuery(this.component.lib.getStatus, { emailId })
  }

  /**
   * Gets a full email, including its body.
   *
   * @param ctx Any context that can run a query.
   * @param emailId The id of the email. This was returned from {@link sendEmail}.
   * @returns The email, or null if the email does not exist.
   */
  async get(
    ctx: QueryCtx | MutationCtx | ActionCtx,
    emailId: EmailId
  ): Promise<EmailDetails | null> {
    return await ctx.runQuery(this.component.lib.get, { emailId })
  }

  /**
   * Handles an Amazon SES event webhook delivered through an Amazon SNS HTTPS
   * subscription.
   *
   * Verifies the SNS message signature, rejects messages from unexpected
   * topics, confirms subscriptions automatically, and applies event records
   * (delivery, bounce, complaint, open, click, ...) to the tracked emails,
   * calling your `onEmailEvent` mutation if it is set.
   *
   * @param ctx Any context that can run a mutation.
   * @param req The request to handle from Amazon SNS.
   * @returns A response to send back to Amazon SNS.
   */
  async handleSesEventWebhook(
    ctx: MutationCtx | ActionCtx,
    req: Request
  ): Promise<Response> {
    if (this.config.snsTopicArns.length === 0) {
      throw new Error("SNS topic ARN is not set")
    }
    try {
      if (req.method !== "POST")
        return new Response("Method not allowed", { status: 405 })
      const message = parseSnsMessage(await readLimitedBody(req, 1024 * 1024))
      if (!this.config.snsTopicArns.includes(message.TopicArn)) {
        throw new SnsVerificationError(
          `Unexpected TopicArn "${message.TopicArn}"`
        )
      }
      await verifySnsMessage(message, {
        fetchCertificate: this.fetchCertificate,
      })

      switch (message.Type) {
        case "SubscriptionConfirmation": {
          if (!isTrustedSnsUrl(message.SubscribeURL)) {
            throw new SnsVerificationError(
              "SubscribeURL is not an Amazon SNS endpoint"
            )
          }
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 10_000)
          let response: Response
          try {
            response = await fetch(message.SubscribeURL, {
              redirect: "error",
              signal: controller.signal,
            })
            await response.body?.cancel()
          } finally {
            clearTimeout(timer)
          }
          if (!response.ok) {
            return new Response("Failed to confirm SNS subscription", {
              status: 502,
            })
          }
          console.log(`Confirmed SNS subscription to ${message.TopicArn}`)
          return new Response("Subscription confirmed", { status: 200 })
        }
        case "UnsubscribeConfirmation":
          console.warn(`SNS subscription to ${message.TopicArn} was removed`)
          return new Response(null, { status: 200 })
        case "Notification": {
          let event: unknown
          try {
            event = JSON.parse(message.Message)
          } catch {
            console.warn(
              "SNS notification Message is not JSON; is raw message delivery enabled?"
            )
            return new Response(null, { status: 200 })
          }
          const handled = await ctx.runMutation(
            this.component.lib.handleEmailEvent,
            {
              event,
              notificationId: `${message.TopicArn}:${message.MessageId}`,
            }
          )
          // SNS can beat the mutation recording SendEmail's response. A 503
          // preserves the notification through SNS's normal retry policy.
          if (handled === false)
            return new Response("Email is not recorded yet", { status: 503 })
          return new Response(null, { status: 200 })
        }
      }
    } catch (error) {
      if (error instanceof SnsVerificationError) {
        console.warn(`Rejected SNS message: ${error.message}`)
        return new Response(error.message, { status: 400 })
      }
      throw error
    }
  }

  /**
   * Defines a mutation to run after an email event occurs.
   *
   * It is usually simpler to define your mutation as an `internalMutation`
   * with `vOnEmailEventArgs` as the args. See the README for an example.
   *
   * @param handler The handler to run after an email event occurs.
   * @returns The mutation to run after an email event occurs.
   */
  defineOnEmailEvent<DataModel extends GenericDataModel>(
    handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: { id: EmailId; event: EmailEvent }
    ) => Promise<void>
  ) {
    return internalMutationGeneric({
      args: vOnEmailEventArgs,
      returns: v.null(),
      handler,
    })
  }

  private assertCredentials() {
    const { region, credentials } = this.config
    if (region === "") throw new Error("AWS region is not set")
    if (credentials.accessKeyId === "" || credentials.secretAccessKey === "") {
      throw new Error("AWS credentials are not set")
    }
  }
}
