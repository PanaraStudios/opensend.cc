import {
  createFunctionHandle,
  internalMutationGeneric,
  type FunctionHandle,
  type FunctionReference,
  type FunctionVisibility,
} from "convex/server"
import { v } from "convex/values"
import {
  validateEmail,
  validateDelivery,
  vOnEmailEventArgs,
  type Email,
} from "../component/shared.js"

import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server"
import { Webhook } from "standardwebhooks"

import type { ComponentApi } from "../component/_generated/component.js"
import type { EmailEvent, EmailStatus } from "../component/shared.js"

/* App-facing client, shaped like the Resend class from @convex-dev/resend.

     const opensend = new OpenSend(components.opensend, {
       apiKey: env.OPENSEND_API_KEY,
       baseUrl: env.OPENSEND_BASE_URL,
       webhookSecret: env.OPENSEND_WEBHOOK_SECRET,
     })
     await opensend.sendEmail(ctx, { from, to, subject, html })

   Each method checks only the settings it needs, so a deployment can verify
   webhooks without a send key and the other way round. */

/* Mutations, actions, and HTTP actions can all send. */
type RunMutationCtx =
  | Pick<GenericMutationCtx<GenericDataModel>, "runMutation">
  | Pick<GenericActionCtx<GenericDataModel>, "runMutation">
type RunQueryCtx =
  | Pick<GenericQueryCtx<GenericDataModel>, "runQuery">
  | Pick<GenericActionCtx<GenericDataModel>, "runQuery">

export type OpenSendOptions = {
  /* An os_ key from the OpenSend dashboard. */
  apiKey?: string
  /* The installation's API address, for example https://api.example.com. */
  baseUrl?: string
  /* The whsec_ secret of a webhook pointed at this app. */
  webhookSecret?: string
  onEmailEvent?:
    | FunctionReference<
        "mutation",
        FunctionVisibility,
        { id: string; event: EmailEvent }
      >
    | FunctionHandle<"mutation", { id: string; event: EmailEvent }>
  /* Attempts per email, including the first. Default 5. */
  maxAttempts?: number
  /* Wait before the first retry. Doubles each time. Default 2 seconds. */
  initialBackoffMs?: number
}

export type SendEmailOptions = Omit<Email, "to" | "cc" | "bcc" | "replyTo"> & {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string | string[]
  /** Dedupe enqueues within this component's retention window. */
  idempotencyKey?: string
}
export {
  vEmailEvent,
  vOnEmailEventArgs,
  vStatus,
  vTemplate,
  MAX_EMAIL_BYTES,
} from "../component/shared.js"
export type { EmailEvent, Status } from "../component/shared.js"

export type { EmailStatus }

export class OpenSend {
  constructor(
    private readonly component: ComponentApi,
    private readonly options: OpenSendOptions = {}
  ) {}

  /* Queues the email and returns its id for status and cancelEmail. */
  async sendEmail(
    ctx: RunMutationCtx,
    email: SendEmailOptions
  ): Promise<string> {
    const { apiKey, baseUrl } = this.options
    if (!apiKey || !baseUrl) {
      throw new Error("OpenSend needs apiKey and baseUrl to send email.")
    }
    const input: Email = {
      from: email.from,
      to: list(email.to),
      cc: optionalList(email.cc),
      bcc: optionalList(email.bcc),
      replyTo: optionalList(email.replyTo),
      subject: email.subject,
      html: email.html,
      text: email.text,
      template: email.template,
      headers: email.headers,
      tags: email.tags,
      scheduledAt: email.scheduledAt,
      topicId: email.topicId,
      attachments: email.attachments,
    }
    const delivery = {
      apiKey,
      baseUrl,
      maxAttempts: this.options.maxAttempts ?? 5,
      initialBackoffMs: this.options.initialBackoffMs ?? 2000,
    }
    validateEmail(input)
    validateDelivery(delivery)
    return await ctx.runMutation(this.component.lib.sendEmail, {
      email: input,
      delivery,
      enqueueKey: email.idempotencyKey,
      onEmailEvent: this.options.onEmailEvent
        ? typeof this.options.onEmailEvent === "string"
          ? this.options.onEmailEvent
          : await createFunctionHandle(this.options.onEmailEvent)
        : undefined,
    })
  }

  async get(ctx: RunQueryCtx, emailId: string) {
    return await ctx.runQuery(this.component.lib.get, { emailId })
  }

  async cleanupOldEmails(
    ctx: RunMutationCtx,
    options: { olderThan?: number } = {}
  ) {
    return await ctx.runMutation(this.component.lib.cleanupOldEmails, options)
  }

  defineOnEmailEvent<DataModel extends GenericDataModel>(
    handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: { id: string; event: EmailEvent }
    ) => Promise<void>
  ) {
    return internalMutationGeneric({
      args: vOnEmailEventArgs,
      returns: v.null(),
      handler: async (ctx, args) => {
        await handler(ctx, args)
        return null
      },
    })
  }

  async cancelEmail(ctx: RunMutationCtx, emailId: string): Promise<boolean> {
    return await ctx.runMutation(this.component.lib.cancelEmail, { emailId })
  }

  async status(ctx: RunQueryCtx, emailId: string): Promise<EmailStatus | null> {
    return await ctx.runQuery(this.component.lib.status, { emailId })
  }

  /* Mount on a POST route in convex/http.ts. OpenSend signs webhooks the
     way Svix does, with svix-* headers. */
  async handleOpenSendEventWebhook(
    ctx: RunMutationCtx,
    req: Request
  ): Promise<Response> {
    const secret = this.options.webhookSecret
    if (!secret) {
      return new Response("OpenSend webhook secret is not set.", {
        status: 503,
      })
    }
    const body = await req.text()
    let payload: unknown
    try {
      payload = new Webhook(secret).verify(body, {
        "webhook-id":
          req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "",
        "webhook-timestamp":
          req.headers.get("svix-timestamp") ??
          req.headers.get("webhook-timestamp") ??
          "",
        "webhook-signature":
          req.headers.get("svix-signature") ??
          req.headers.get("webhook-signature") ??
          "",
      })
    } catch {
      return new Response("Invalid signature.", { status: 401 })
    }
    const event = toEmailEvent(payload)
    if (event) {
      await ctx.runMutation(this.component.lib.handleEmailEvent, { event })
    }
    return new Response(null, { status: 204 })
  }
}

const TRACKED_EVENTS = new Set<string>([
  "email.sent",
  "email.delivery_delayed",
  "email.delivered",
  "email.bounced",
  "email.failed",
  "email.suppressed",
  "email.complained",
  "email.opened",
  "email.clicked",
])

/* Narrows a verified payload to the fields the component stores. Contact,
   domain, and other events return null. */
function toEmailEvent(payload: unknown): EmailEvent | null {
  if (!isRecord(payload) || typeof payload.type !== "string") return null
  if (!TRACKED_EVENTS.has(payload.type)) return null
  const data = isRecord(payload.data) ? payload.data : null
  if (!data || typeof data.email_id !== "string") return null
  const message =
    nestedString(data.bounce, "message") ??
    nestedString(data.failed, "reason") ??
    nestedString(data.suppressed, "message")
  const tags = isRecord(data.tags) ? data.tags : null
  return {
    type: payload.type as EmailEvent["type"],
    ...(typeof tags?.opensend_component_email === "string"
      ? { componentEmailId: tags.opensend_component_email }
      : {}),
    opensendId: data.email_id,
    ...(message ? { message } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nestedString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? (value[key] as string)
    : undefined
}

function list(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

function optionalList(value?: string | string[]): string[] | undefined {
  return value === undefined ? undefined : list(value)
}
