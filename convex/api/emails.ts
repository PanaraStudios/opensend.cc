import type { FileReference } from "../storage/files"
import { requireEmailConfigured } from "../access"
import { teamRow } from "../lists"
import { stream } from "convex-helpers/server/stream"
import { idempotent } from "./idempotency"
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
  errorMessage,
  newEmailValue,
  rescheduleEmail,
  resolvedSenderValue,
  type ResolvedSender,
  type NewEmail,
} from "../emails"
import { downloadLink, sentAttachmentId } from "../receivedDownloads"
import { requireSmtp } from "../smtp"
import schema from "../schema"
import {
  apiError,
  callerValue,
  notFound,
  requireCaller,
  type Caller,
  invalid,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  listBody,
  apiRoute,
  apiTime,
  listParams,
  objectBody,
  stringField,
  objectField,
  arrayField,
  stringListField,
} from "./route"
import {
  attachmentContentType,
  parseScheduledAt,
  parseMailbox,
  senderDomainOf,
} from "../../lib/dashboard/email-send"

/** Resend's limits: 100 emails a batch, 40 MB of base64 attachments. */
const MAX_BATCH = 100
const MAX_ATTACHMENTS = 40 * 1024 * 1024
/** The attachments plus the rest of the JSON. Convex's own HTTP limit may
    be lower; see docs/rest-api.md. */
export const MAX_SEND_BODY = MAX_ATTACHMENTS + 2 * 1024 * 1024

/** A team email the caller may see, or null. */
function own(ctx: QueryCtx, caller: Caller, id: string) {
  return teamRow(ctx, "emails", caller.organizationId, id)
}

export const authorizeSending = internalQuery({
  args: { caller: callerValue },
  returns: v.null(),
  handler: async (ctx, { caller }) => {
    await requireCaller(ctx, caller, "sending")
    await requireEmailConfigured(ctx)
    return null
  },
})

export const send = internalMutation({
  args: {
    caller: callerValue,
    emails: v.array(newEmailValue),
    batch: v.optional(v.boolean()),
    source: v.optional(v.literal("smtp")),
  },
  returns: v.array(v.id("emails")),
  handler: async (ctx, { caller, emails, source, batch }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller, "sending")
        if (source === "smtp") await requireSmtp(ctx, caller)
        const ids: Id<"emails">[] = []
        const senders = new Map<string, ResolvedSender>()
        // One transaction: a batch with any invalid email sends none of them.
        for (const email of emails)
          ids.push(
            await createEmail(ctx, email, {
              organizationId: caller.organizationId,
              source: source ?? "api",
              apiKeyId: caller.apiKeyId,
              onlyDomain: caller.domainId,
              senders,
            })
          )
        return ids
      },
      (ids) => ({
        body: batch ? { data: ids.map((id) => ({ id })) } : { id: ids[0] },
      })
    )
  },
})

/** Called only inside an authorized batch; each item has its own rollback. */
export const createBatchItem = internalMutation({
  args: {
    caller: callerValue,
    email: newEmailValue,
    sender: v.optional(resolvedSenderValue),
  },
  returns: v.object({ id: v.id("emails"), sender: resolvedSenderValue }),
  handler: async (ctx, { caller, email, sender }) => {
    const senders = new Map<string, ResolvedSender>()
    const id = await createEmail(ctx, email, {
      organizationId: caller.organizationId,
      source: "api",
      apiKeyId: caller.apiKeyId,
      onlyDomain: caller.domainId,
      sender,
      senders,
    })
    return { id, sender: [...senders.values()][0] }
  },
})

export const batchSend = internalMutation({
  args: { caller: callerValue, body: v.string(), permissive: v.boolean() },
  returns: v.object({
    data: v.array(v.object({ id: v.id("emails") })),
    errors: v.optional(
      v.array(v.object({ index: v.number(), message: v.string() }))
    ),
  }),
  handler: async (
    ctx,
    { caller, body, permissive }
  ): Promise<{
    data: { id: Id<"emails"> }[]
    errors?: { index: number; message: string }[]
  }> =>
    idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller, "sending")
        await requireEmailConfigured(ctx)
        const items: unknown = JSON.parse(body)
        if (!Array.isArray(items))
          throw invalid("The request body must be an array of emails.")
        if (!items.length || items.length > MAX_BATCH)
          throw invalid(`A batch must have between 1 and ${MAX_BATCH} emails.`)
        const data: { id: Id<"emails"> }[] = []
        const errors: { index: number; message: string }[] = []
        const senders = new Map<string, ResolvedSender>()
        for (const [index, item] of items.entries()) {
          try {
            const { input } = parseEmail(item, Date.now(), true)
            const mailbox = input.from ? parseMailbox(input.from) : null
            // The child transaction rolls back all writes for a refused item.
            const { id, sender } = await ctx.runMutation(
              internal.api.emails.createBatchItem,
              {
                caller,
                email: { ...input, attachments: [] },
                sender: mailbox
                  ? senders.get(senderDomainOf(mailbox))
                  : undefined,
              }
            )
            senders.set(sender.domain.name, sender)
            data.push({ id })
          } catch (error) {
            const message = errorMessage(error)
            if (!permissive || !message) throw error
            errors.push({ index, message })
          }
        }
        return { data, ...(permissive ? { errors } : {}) }
      },
      (body) => ({ body })
    ),
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
      async (id) => await own(ctx, caller, id),
      (order) =>
        stream(ctx.db, schema)
          .query("emails")
          .withIndex("by_organizationId", (q) => {
            return q.eq("organizationId", org)
          })
          .order(order)
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
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const email = await own(ctx, caller, id)
        if (!email) return null
        if (action.kind === "cancel") await cancelEmail(ctx, email)
        else await rescheduleEmail(ctx, email, action.at)
        return email._id
      },
      (id) => {
        if (!id) throw notFound("Email")
        return { body: { object: "email", id } }
      }
    )
  },
})

/* ---------------------------------------------------------- the request */

type Attachment = {
  bytes?: Uint8Array
  path?: string
  id?: string
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
    const id = stringField(fields, "id")
    const content = stringField(fields, "content")
    const path = stringField(fields, "path")
    if (content === undefined && path === undefined && id === undefined)
      throw apiError(
        422,
        "invalid_attachment",
        "Attachment must have either a `content` or `path`."
      )
    size += content?.length ?? 0
    if (size > MAX_ATTACHMENTS)
      throw apiError(
        422,
        "invalid_attachment",
        "Attachments can be at most 40 MB in total after base64 encoding."
      )
    let filename = stringField(fields, "filename")
    if (!filename && path) {
      try {
        filename = decodeURIComponent(
          new URL(path).pathname.split("/").pop() || "attachment"
        )
      } catch {
        throw apiError(422, "invalid_attachment", "Invalid attachment path.")
      }
    }
    if (!filename && id) filename = "attachment"
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
      ...(id
        ? { id }
        : content === undefined
          ? { path }
          : { bytes: decodeBase64(content) }),
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
    topicId: stringField(body, "topic_id"),
    from: stringField(body, "from"),
    to: stringListField(body, "to") ?? [],
    cc: stringListField(body, "cc") ?? [],
    bcc: stringListField(body, "bcc") ?? [],
    replyTo: stringListField(body, "reply_to") ?? [],
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
  parsed: ReturnType<typeof parseEmail>[],
  source?: "smtp",
  batch = false
) {
  const stored: FileReference[] = []
  try {
    const emails: NewEmail[] = []
    for (const { input, attachments } of parsed) {
      const files = []
      let totalBytes = 0
      for (const { bytes, path, id, ...attachment } of attachments) {
        if (id) {
          const file = await ctx.runQuery(internal.storage.files.authorized, {
            organizationId: caller.organizationId,
            caller,
            id: id as Id<"storedFiles">,
          })
          if (file.state !== "ready" || file.feature !== "email")
            throw invalid("Attachment upload is not ready")
          totalBytes += file.size
          if (Math.ceil(totalBytes / 3) * 4 > MAX_ATTACHMENTS)
            throw invalid(
              "Attachments can be at most 40 MB after base64 encoding"
            )
          files.push({
            fileId: file._id,
            filename: file.filename ?? attachment.filename,
            contentType: file.contentType,
            contentId: attachment.contentId,
            size: file.size,
          })
        } else if (path) {
          const file = await ctx.runAction(
            internal.emailAttachments.fetchFile,
            {
              caller,
              path,
              ...attachment,
              maxBytes: Math.floor((MAX_ATTACHMENTS * 3) / 4) - totalBytes,
            }
          )
          stored.push({ fileId: file.fileId, storageId: file.storageId })
          totalBytes += file.size
          files.push(file)
        } else {
          totalBytes += bytes!.length
          if (Math.ceil(totalBytes / 3) * 4 > MAX_ATTACHMENTS)
            throw apiError(
              422,
              "invalid_attachment",
              "Attachments can be at most 40 MB after base64 encoding."
            )
          const storageId = await ctx.storage.store(
            new Blob([bytes! as BlobPart], { type: attachment.contentType })
          )
          const file = await ctx.runAction(internal.storage.objects.adopt, {
            organizationId: caller.organizationId,
            feature: "email",
            storageId,
            contentType: attachment.contentType,
            filename: attachment.filename,
          })
          stored.push({ fileId: file.fileId, storageId: file.storageId })
          files.push({ ...attachment, size: bytes!.length, ...file })
        }
      }
      emails.push({ ...input, attachments: files })
    }
    return await ctx.runMutation(internal.api.emails.send, {
      caller,
      emails,
      source,
      batch,
    })
  } catch (e) {
    for (const file of stored)
      await ctx.runMutation(internal.storage.files.discard, file)
    throw e
  }
}

export async function sendEmailBody(
  ctx: ActionCtx,
  caller: Caller,
  body: unknown,
  source?: "smtp"
) {
  const [id] = await sendParsed(
    ctx,
    caller,
    [parseEmail(body, Date.now(), false)],
    source
  )
  return { body: { id }, emailId: id }
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
    ...(email.status === "failed" && email.error
      ? {
          failed: {
            reason: email.error,
            ...(email.providerError
              ? { provider_message: email.providerError }
              : {}),
          },
        }
      : {}),
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
    scope: { resource: "emails", access: "write" },
    maxBody: MAX_SEND_BODY,
    handler: async (ctx, { caller, body }) => {
      return sendEmailBody(ctx, caller, body)
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/emails/batch",
    idempotencyHeaders: { "x-batch-validation": "strict" },
    scope: { resource: "emails", access: "write" },
    handler: async (ctx, { caller, body, headers }) => {
      const mode = headers.get("x-batch-validation") ?? "strict"
      if (mode !== "strict" && mode !== "permissive")
        throw invalid(
          "The `x-batch-validation` header must be strict or permissive."
        )
      return {
        body: await ctx.runMutation(internal.api.emails.batchSend, {
          caller,
          body: JSON.stringify(body ?? null),
          permissive: mode === "permissive",
        }),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/emails",
    scope: { resource: "emails", access: "read" },
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.emails.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: listBody(page, summary),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/emails/{id}",
    scope: { resource: "emails", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const found = await ctx.runQuery(internal.api.emails.get, {
        caller,
        id: params.id,
      })
      if (!found) throw notFound("Email")
      return { body: detail(found.email, found.content) }
    },
  })
  for (const single of [false, true])
    apiRoute(http, {
      method: "GET",
      path: `/emails/{id}/attachments${single ? "/{attachmentId}" : ""}`,
      scope: { resource: "emails", access: "read" },
      handler: async (ctx, { caller, params, query }) => {
        const found = await ctx.runQuery(internal.api.emails.get, {
          caller,
          id: params.id,
        })
        if (!found) throw notFound("Email")
        const files = (found.content?.attachments ?? []).map((file, index) => ({
          ...file,
          id: sentAttachmentId(found.email._id, index),
        }))
        let selected = files
        let has_more = false
        if (single) {
          selected = files.filter((file) => file.id === params.attachmentId)
          if (!selected.length) throw notFound("Attachment")
        } else {
          const { limit, after, before } = listParams(query)
          const cursor = after ?? before
          const anchor =
            cursor === undefined
              ? -1
              : files.findIndex((file) => file.id === cursor)
          if (cursor !== undefined && anchor < 0)
            throw invalid("Invalid attachment cursor.")
          const start = before ? Math.max(0, anchor - limit) : anchor + 1
          const end = before ? anchor : start + limit
          selected = files.slice(start, end)
          has_more = before ? start > 0 : end < files.length
        }
        const data = await Promise.all(
          selected.map(async (file) => ({
            id: file.id,
            filename: file.filename,
            size: file.size,
            content_type: file.contentType,
            content_disposition: file.contentId ? "inline" : "attachment",
            content_id: file.contentId ?? null,
            ...(await downloadLink(ctx, found.email._id, file.id, true)),
          }))
        )
        return {
          body: single
            ? { object: "attachment", ...data[0] }
            : { object: "list", has_more, data },
        }
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
    scope: { resource: "emails", access: "write" },
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
    scope: { resource: "emails", access: "write" },
    handler: (ctx, { caller, params }) =>
      changeEmail(ctx, caller, params.id, { kind: "cancel" }),
  })
}
