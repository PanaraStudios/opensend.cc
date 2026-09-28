import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import {
  cancelEmail,
  createEmail,
  newEmailValue,
  rescheduleEmail,
  type NewEmail,
} from "../emails"
import schema from "../schema"
import {
  apiError,
  callerValue,
  notFound,
  requireCaller,
  type Caller,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import { apiRoute, apiTime, listParams, objectBody, stringField } from "./route"
import {
  attachmentContentType,
  parseScheduledAt,
} from "../../lib/dashboard/email-send"

/** Resend's limits: 100 emails a batch, 40 MB of base64 attachments. */
const MAX_BATCH = 100
const MAX_ATTACHMENTS = 40 * 1024 * 1024
/** The attachments plus the rest of the JSON. Convex's own HTTP limit may
    be lower; see docs/rest-api.md. */
const MAX_SEND_BODY = MAX_ATTACHMENTS + 2 * 1024 * 1024

/** A team email the caller may see, or null. */
async function own(ctx: QueryCtx, caller: Caller, id: string) {
  const emailId = ctx.db.normalizeId("emails", id)
  const email = emailId ? await ctx.db.get("emails", emailId) : null
  return email?.organizationId === caller.organizationId ? email : null
}

export const send = internalMutation({
  args: { caller: callerValue, emails: v.array(newEmailValue) },
  returns: v.array(v.id("emails")),
  handler: async (ctx, { caller, emails }) => {
    await requireCaller(ctx, caller, "sending")
    const ids: Id<"emails">[] = []
    // One transaction: a batch with any invalid email sends none of them.
    for (const email of emails)
      ids.push(
        await createEmail(ctx, email, {
          organizationId: caller.organizationId,
          source: "api",
          apiKeyId: caller.apiKeyId,
          onlyDomain: caller.domainId,
        })
      )
    return ids
  },
})

export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      email: schema.doc("emails"),
      content: v.union(v.null(), schema.doc("emailContents")),
    })
  ),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const email = await own(ctx, caller, id)
    if (!email) return null
    const content = await ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
      .unique()
    return { email, content }
  },
})

export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("emails")),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const org = caller.organizationId
    return cursorPage(
      page,
      async (id) => (await own(ctx, caller, id))?._creationTime ?? null,
      (bound, order, count) =>
        ctx.db
          .query("emails")
          .withIndex("by_organizationId", (q) => {
            const scope = q.eq("organizationId", org)
            return bound.lt !== undefined
              ? scope.lt("_creationTime", bound.lt)
              : bound.gt !== undefined
                ? scope.gt("_creationTime", bound.gt)
                : scope
          })
          .order(order)
          .take(count)
    )
  },
})

export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    action: v.union(
      v.object({ kind: v.literal("cancel") }),
      v.object({ kind: v.literal("reschedule"), at: v.number() })
    ),
  },
  returns: v.union(v.null(), v.id("emails")),
  handler: async (ctx, { caller, id, action }) => {
    await requireCaller(ctx, caller)
    const email = await own(ctx, caller, id)
    if (!email) return null
    if (action.kind === "cancel") await cancelEmail(ctx, email)
    else await rescheduleEmail(ctx, email, action.at)
    return email._id
  },
})

/* ---------------------------------------------------------- the request */

const invalid = (message: string) => apiError(422, "validation_error", message)

/** A string or an array of strings, as Resend takes recipients. */
function addresses(body: Record<string, unknown>, name: string) {
  const value = body[name]
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  if (!list.every((item) => typeof item === "string"))
    throw invalid(
      `The \`${name}\` field must be a string or an array of strings.`
    )
  return list as string[]
}
function objectField(body: Record<string, unknown>, name: string) {
  const value = body[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object" || Array.isArray(value))
    throw invalid(`The \`${name}\` field must be an object.`)
  return value as Record<string, unknown>
}
function arrayField(body: Record<string, unknown>, name: string) {
  const value = body[name]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value))
    throw invalid(`The \`${name}\` field must be an array.`)
  return value as unknown[]
}

type Attachment = {
  bytes: Uint8Array
  filename: string
  contentType: string
  contentId?: string
}
function decodeBase64(content: string) {
  const clean = content.replace(/\s+/g, "")
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1)
    throw apiError(
      422,
      "invalid_attachment",
      "Attachment `content` must be base64."
    )
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    throw apiError(
      422,
      "invalid_attachment",
      "Attachment `content` must be base64."
    )
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
function attachments(body: Record<string, unknown>, batch: boolean) {
  const items = arrayField(body, "attachments")
  if (batch && items.length)
    throw invalid("The `attachments` field is not supported in batch emails.")
  let size = 0
  return items.map((item): Attachment => {
    const fields = objectBody(item)
    const content = stringField(fields, "content")
    const path = stringField(fields, "path")
    if (content === undefined && path === undefined)
      throw apiError(
        422,
        "invalid_attachment",
        "Attachment must have either a `content` or `path`."
      )
    if (content === undefined)
      throw apiError(
        422,
        "invalid_attachment",
        "Attachments by `path` are not supported on this server. Send the file as base64 `content`."
      )
    size += content.length
    if (size > MAX_ATTACHMENTS)
      throw apiError(
        422,
        "invalid_attachment",
        "Attachments can be at most 40 MB in total after base64 encoding."
      )
    const filename = stringField(fields, "filename")
    if (!filename)
      throw apiError(
        422,
        "invalid_attachment",
        "Attachment must have a `filename`."
      )
    const contentId = stringField(fields, "content_id")
    const contentType =
      stringField(fields, "content_type") ?? attachmentContentType(filename)
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(contentType))
      throw apiError(
        422,
        "invalid_attachment",
        "Attachment `content_type` must be a MIME type."
      )
    if (
      contentId !== undefined &&
      (!contentId || contentId.length > 78 || /[\s<>]/.test(contentId))
    )
      throw apiError(
        422,
        "invalid_attachment",
        "Attachment `content_id` is not valid."
      )
    return {
      bytes: decodeBase64(content),
      filename,
      contentType,
      ...(contentId ? { contentId } : {}),
    }
  })
}

/** One email of a request body, before the domain and template checks the
    mutation makes. */
function parseEmail(item: unknown, now: number, batch: boolean) {
  const body = objectBody(item)
  if (body.topic_id !== undefined && body.topic_id !== null)
    throw invalid("The `topic_id` field is not supported on this server yet.")
  const headers = objectField(body, "headers") ?? {}
  const template = objectField(body, "template")
  const variables = template ? (objectField(template, "variables") ?? {}) : {}
  const scheduled = stringField(body, "scheduled_at")
  const scheduledAt =
    scheduled === undefined ? undefined : parseScheduledAt(scheduled, now)
  if (scheduledAt === null)
    throw invalid(
      "Invalid `scheduled_at` field. Use an ISO 8601 date or natural language like `in 1 min`."
    )
  const input: Omit<NewEmail, "attachments"> = {
    from: stringField(body, "from"),
    to: addresses(body, "to"),
    cc: addresses(body, "cc"),
    bcc: addresses(body, "bcc"),
    replyTo: addresses(body, "reply_to"),
    subject: stringField(body, "subject"),
    html: stringField(body, "html"),
    text: stringField(body, "text"),
    headers: Object.entries(headers).map(([name, value]) => {
      if (typeof value !== "string")
        throw invalid(`The value of the \`${name}\` header must be a string.`)
      return { name, value }
    }),
    tags: arrayField(body, "tags").map((tag) => {
      const fields = objectBody(tag)
      return {
        name: stringField(fields, "name", true)!,
        value: stringField(fields, "value", true)!,
      }
    }),
    ...(scheduledAt === undefined ? {} : { scheduledAt }),
    ...(template
      ? {
          template: {
            id: stringField(template, "id", true)!,
            variables: Object.entries(variables).map(([key, value]) => {
              if (typeof value !== "string" && typeof value !== "number")
                throw invalid(
                  `The template variable \`${key}\` must be a string or a number.`
                )
              return { key, value }
            }),
          },
        }
      : {}),
  }
  return { input, attachments: attachments(body, batch) }
}

/** Stores the attachments, sends, and removes the files again if the send
    is refused. */
async function sendParsed(
  ctx: ActionCtx,
  caller: Caller,
  parsed: ReturnType<typeof parseEmail>[]
) {
  const stored: Id<"_storage">[] = []
  try {
    const emails: NewEmail[] = []
    for (const { input, attachments } of parsed) {
      const files = []
      for (const { bytes, ...attachment } of attachments) {
        const storageId = await ctx.storage.store(
          new Blob([bytes as BlobPart], { type: attachment.contentType })
        )
        stored.push(storageId)
        files.push({ ...attachment, size: bytes.length, storageId })
      }
      emails.push({ ...input, attachments: files })
    }
    return await ctx.runMutation(internal.api.emails.send, { caller, emails })
  } catch (e) {
    for (const id of stored) await ctx.storage.delete(id)
    throw e
  }
}

const all = (values: string[] | undefined) => values ?? []
function summary(email: Doc<"emails">) {
  return {
    id: email._id,
    message_id: email.messageId ?? null,
    to: email.to,
    from: email.from,
    created_at: apiTime(email._creationTime),
    subject: email.subject,
    bcc: email.bcc ?? null,
    cc: email.cc ?? null,
    reply_to: email.replyTo ?? null,
    last_event: email.status,
    scheduled_at:
      email.scheduledAt === undefined ? null : apiTime(email.scheduledAt),
  }
}
function detail(email: Doc<"emails">, content: Doc<"emailContents"> | null) {
  return {
    object: "email",
    ...summary(email),
    html: content?.html ?? null,
    text: content?.text ?? null,
    bcc: all(email.bcc),
    cc: all(email.cc),
    reply_to: all(email.replyTo),
    tags: email.tags ?? [],
  }
}
type Change = { kind: "cancel" } | { kind: "reschedule"; at: number }

/** `/emails`, as Resend documents it. Ids are Convex ids, not UUIDs. */
export function registerEmailRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/emails",
    permission: "sending",
    maxBody: MAX_SEND_BODY,
    handler: async (ctx, { caller, body }) => {
      const [id] = await sendParsed(ctx, caller, [
        parseEmail(body, Date.now(), false),
      ])
      return { body: { id }, emailId: id }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/emails/batch",
    permission: "sending",
    handler: async (ctx, { caller, body }) => {
      if (!Array.isArray(body))
        throw invalid("The request body must be an array of emails.")
      if (!body.length || body.length > MAX_BATCH)
        throw invalid(`A batch must have between 1 and ${MAX_BATCH} emails.`)
      const now = Date.now()
      const ids = await sendParsed(
        ctx,
        caller,
        body.map((item) => parseEmail(item, now, true))
      )
      return { body: { data: ids.map((id) => ({ id })) } }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/emails",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.emails.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: page.has_more,
          data: page.data.map(summary),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/emails/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => {
      const found = await ctx.runQuery(internal.api.emails.get, {
        caller,
        id: params.id,
      })
      if (!found) throw notFound("Email")
      return { body: detail(found.email, found.content) }
    },
  })
  const changeEmail = async (
    ctx: ActionCtx,
    caller: Caller,
    id: string,
    action: Change
  ) => {
    const changed = await ctx.runMutation(internal.api.emails.change, {
      caller,
      id,
      action,
    })
    if (!changed) throw notFound("Email")
    return { body: { object: "email", id: changed } }
  }
  apiRoute(http, {
    method: "PATCH",
    path: "/emails/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params, body }) => {
      const scheduled = stringField(objectBody(body), "scheduled_at", true)!
      const at = parseScheduledAt(scheduled, Date.now())
      if (at === null)
        throw invalid(
          "Invalid `scheduled_at` field. Use an ISO 8601 date or natural language like `in 1 min`."
        )
      return changeEmail(ctx, caller, params.id, { kind: "reschedule", at })
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/emails/{id}/cancel",
    permission: "full_access",
    handler: (ctx, { caller, params }) =>
      changeEmail(ctx, caller, params.id, { kind: "cancel" }),
  })
}
