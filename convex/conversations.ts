import {
  latestInbound,
  scheduleControl,
  typingMessage,
} from "./channels/controls"
import { contactIdentity } from "../lib/dashboard/contacts"
import { primaryContactIdentity, teamRow } from "./audience"
import { contactChannelIdentityValue } from "./contacts"
import { object } from "../lib/meta/parse"
import {
  channelMessagePayload,
  hydratedChannelMessage,
} from "./channels/payload"
import {
  renderedChannelTemplate,
  type TemplatePageCache,
} from "./channels/templates"
import { channelStrategies } from "../lib/meta/payloads"
import { ConvexError, v, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  mergedStream,
  stream,
  type QueryStream,
} from "convex-helpers/server/stream"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import { countValue, counters, patchRow } from "./counts"
import { filteredPage, matchesSearch, readTeamRow } from "./lists"
import { createEmail, errorMessage } from "./emails"
import { createChannelMessage } from "./channels/messages"
import { upsertEmailThread } from "./channels/identity"
import { resolveWhatsAppTemplate } from "./whatsapp/templates"
import { storedComponents, templateMediaHeader } from "../lib/meta/templates"
import { mediaFiles } from "./messages"
import { channelAccountAccess } from "./channels/messages"
import { upsertChannelThread } from "./channels/identity"
import { toWaId } from "../lib/dashboard/phone"
import type {
  WhatsAppContext,
  WhatsAppReferral,
} from "../packages/sdk/src/whatsapp/catalog"
import {
  CHANNELS,
  CONVERSATION_STATUSES,
  channelValue,
  conversationStatusValue,
  renderedTemplateValue,
} from "./tables/channels"
import { replyHeaders, replySubject } from "../lib/dashboard/conversations"

/* The Messages inbox: one thread per person and channel account, or per
   email sender. Sending goes through the channels' own entry points
   (createChannelMessage, createEmail), so every rule there applies. */

const listFilters = v.object({
  organizationId: v.string(),
  channel: v.optional(channelValue),
  status: v.optional(conversationStatusValue),
  unread: v.optional(v.boolean()),
  search: v.optional(v.string()),
})

/** Who a thread is with: their contact's name, else the name the channel
    gave, else the address; and that phone number or email address. */
async function party(ctx: QueryCtx, conversation: Doc<"conversations">) {
  const [contact, identity] = await Promise.all([
    conversation.contactId
      ? ctx.db.get("contacts", conversation.contactId)
      : null,
    conversation.channelContactId
      ? ctx.db.get("channelContacts", conversation.channelContactId)
      : null,
  ])
  const handle =
    contactIdentity(
      contact?.organizationId === conversation.organizationId
        ? contact
        : { email: conversation.emailAddress },
      identity
    ).secondary ?? ""
  const own = contact?.organizationId === conversation.organizationId
  const channelIdentity = own
    ? await primaryContactIdentity(ctx, contact)
    : null
  return {
    name: contactIdentity(
      own ? contact : { email: conversation.emailAddress },
      identity ?? channelIdentity
    ).label,
    handle,
    contact: own
      ? {
          id: contact._id,
          channelIdentity,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
        }
      : null,
    identity,
  }
}

const listItem = v.object({
  conversation: schema.doc("conversations"),
  name: v.string(),
  handle: v.string(),
})

/** Historical thread summaries may still contain a template name. Read only
 * the newest outbound header, then hydrate its body with the shared renderer.
 * Never substitute an older send for a thread's current preview. */
async function conversationPreview(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  cache: TemplatePageCache
): Promise<Doc<"conversations">> {
  if (
    conversation.channel === "email" ||
    conversation.lastDirection !== "outbound"
  )
    return conversation
  const message = await ctx.db
    .query("channelMessages")
    .withIndex("by_conversationId_and_direction", (q) =>
      q.eq("conversationId", conversation._id).eq("direction", "outbound")
    )
    .order("desc")
    .first()
  if (
    message?.organizationId !== conversation.organizationId ||
    message.type !== "template" ||
    message.preview !== conversation.lastPreview
  )
    return conversation
  const [content, account] = await Promise.all([
    ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .unique(),
    conversation.accountId
      ? ctx.db.get("channelAccounts", conversation.accountId)
      : null,
  ])
  const rendered = await renderedChannelTemplate(
    ctx,
    message,
    content,
    account,
    cache
  )
  return rendered
    ? { ...conversation, lastPreview: rendered.body.slice(0, 1000) }
    : conversation
}

export const list = query({
  args: { ...listFilters.fields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listItem),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const { organizationId: org, channel, status, unread } = args
    const rows = stream(ctx.db, schema).query("conversations")
    const search = args.search?.trim().slice(0, 200)
    const matches = matchesSearch(search)
    const result = await filteredPage(
      (channel
        ? rows.withIndex(
            "by_organizationId_and_channel_and_lastMessageAt",
            (q) => q.eq("organizationId", org).eq("channel", channel)
          )
        : rows.withIndex("by_organizationId_and_lastMessageAt", (q) =>
            q.eq("organizationId", org)
          )
      ).order("desc"),
      args.paginationOpts,
      (row) =>
        (status === undefined || row.status === status) &&
        (unread === undefined || row.unread === unread) &&
        matches(row.search, row.lastPreview),
      { rows: 512, bytes: 2 * 1024 * 1024 },
      search
    )
    const templateCache: TemplatePageCache = new Map()
    const page = await Promise.all(
      result.page.map(async (conversation) => {
        const [{ name, handle }, rendered] = await Promise.all([
          party(ctx, conversation),
          conversationPreview(ctx, conversation, templateCache),
        ])
        return { conversation: rendered, name, handle }
      })
    )
    return { ...result, page }
  },
})

/** Contact history uses the projected contact id, so every identity can be
    paged without loading an unbounded list of channel identities first.
    The address stream also covers email threads created before the contact. */
export const contactHistory = query({
  args: {
    organizationId: v.string(),
    contactId: v.id("contacts"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      conversation: schema.doc("conversations"),
      accountHandle: v.string(),
      latest: v.object({
        id: v.string(),
        kind: v.union(
          v.literal("email"),
          v.literal("received"),
          v.literal("channel")
        ),
      }),
    })
  ),
  handler: async (ctx, { organizationId, contactId, paginationOpts }) => {
    await requireTeam(ctx, organizationId)
    const contact = await teamRow(ctx, "contacts", organizationId, contactId)
    const rows = stream(ctx.db, schema).query("conversations")
    const sources: QueryStream<Doc<"conversations">>[] = [
      rows
        .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
        .order("desc"),
    ]
    if (contact.email)
      sources.push(
        rows
          .withIndex("by_organizationId_and_emailAddress", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("emailAddress", contact.email!)
          )
          .order("desc")
          .filterWith(async (row) => row.contactId !== contactId)
      )
    // Merged streams read their source indexes in parallel. Native cursors
    // preserve bounded pages, including old email threads and deduplication.
    const result = await mergedStream(sources, ["_creationTime"]).paginate(
      paginationOpts
    )
    const templateCache: TemplatePageCache = new Map()
    const page = await Promise.all(
      result.page.map(async (conversation) => {
        if (conversation.organizationId !== organizationId) return null
        const [account, latest] = await Promise.all([
          conversation.accountId
            ? ctx.db.get("channelAccounts", conversation.accountId)
            : null,
          latestMessage(ctx, conversation),
        ])
        if (!latest) return null
        return {
          conversation: await conversationPreview(
            ctx,
            conversation,
            templateCache
          ),
          accountHandle:
            account?.organizationId === organizationId
              ? account.handle
              : (conversation.emailAddress ?? ""),
          latest,
        }
      })
    )
    return { ...result, page: page.filter((row) => row !== null) }
  },
})

/** Read just the latest message header; history never loads message bodies. */
async function latestMessage(
  ctx: QueryCtx,
  conversation: Doc<"conversations">
) {
  if (conversation.channel !== "email") {
    const message = await ctx.db
      .query("channelMessages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", conversation._id)
      )
      .order("desc")
      .first()
    return message?.organizationId === conversation.organizationId
      ? { id: message._id, kind: "channel" as const }
      : null
  }
  if (!conversation.emailAddress) return null
  const [received, recipient] = await Promise.all([
    lastReceived(ctx, conversation),
    ctx.db
      .query("emailRecipients")
      .withIndex("by_organizationId_and_address", (q) =>
        q
          .eq("organizationId", conversation.organizationId)
          .eq("address", conversation.emailAddress!)
      )
      .order("desc")
      .first(),
  ])
  const sent = recipient ? await ctx.db.get("emails", recipient.emailId) : null
  const ownSent =
    sent?.organizationId === conversation.organizationId ? sent : null
  if (received && (!ownSent || received.receivedAt >= ownSent._creationTime))
    return { id: received._id, kind: "received" as const }
  return ownSent ? { id: ownSent._id, kind: "email" as const } : null
}

export const count = query({
  args: listFilters.fields,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return {
      total: await counters.conversations.total(ctx, args.organizationId, [
        { is: args.channel, among: CHANNELS },
        { is: args.status, among: CONVERSATION_STATUSES },
        { is: args.unread, among: [true, false] },
      ]),
    }
  },
})

/** One thread with who it is with, the account it is on, and what a reply
    needs. Whether the window is open depends on the clock, so the client
    compares `windowExpiresAt` with its own. */
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      conversation: schema.doc("conversations"),
      name: v.string(),
      handle: v.string(),
      contact: v.union(
        v.null(),
        v.object({
          id: v.id("contacts"),
          channelIdentity: v.union(v.null(), contactChannelIdentityValue),
          email: v.union(v.string(), v.null()),
          phone: v.union(v.string(), v.null()),
        })
      ),
      account: v.union(
        v.null(),
        v.object({
          id: v.id("channelAccounts"),
          handle: v.string(),
          displayName: v.string(),
          wabaId: v.union(v.string(), v.null()),
        })
      ),
      /** The newest received email: a reply's subject and sender. */
      lastEmail: v.union(
        v.null(),
        v.object({ subject: v.string(), to: v.array(v.string()) })
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const conversation = await readTeamRow(ctx, "conversations", id)
    if (!conversation) return null
    const { name, handle, contact } = await party(ctx, conversation)
    const account = conversation.accountId
      ? await ctx.db.get("channelAccounts", conversation.accountId)
      : null
    const last = await lastReceived(ctx, conversation)
    return {
      conversation,
      name,
      handle,
      contact,
      account: account
        ? {
            id: account._id,
            handle: account.handle,
            displayName: account.displayName,
            wabaId: account.wabaId ?? null,
          }
        : null,
      lastEmail: last
        ? { subject: last.subject, to: [...last.to, ...last.receivedFor] }
        : null,
    }
  },
})

/** The newest email the thread's sender sent the team. */
function lastReceived(ctx: QueryCtx, conversation: Doc<"conversations">) {
  const address = conversation.emailAddress
  if (conversation.channel !== "email" || !address) return null
  return ctx.db
    .query("receivedEmails")
    .withIndex("by_organizationId_and_sender_and_receivedAt", (q) =>
      q.eq("organizationId", conversation.organizationId).eq("sender", address)
    )
    .order("desc")
    .first()
}

const threadMessage = v.object({
  id: v.string(),
  /** `email` a team's send, `received` an inbound email, else a channel's. */
  kind: v.union(
    v.literal("email"),
    v.literal("received"),
    v.literal("channel")
  ),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  at: v.number(),
  status: v.string(),
  text: v.string(),
  rendered: v.optional(renderedTemplateValue),
  normalized: v.optional(v.any()),
  subject: v.optional(v.string()),
  error: v.optional(v.string()),
  media: v.array(
    v.object({
      mediaId: v.optional(v.string()),
      contentType: v.string(),
      filename: v.optional(v.string()),
      size: v.optional(v.number()),
      ready: v.boolean(),
      error: v.optional(v.string()),
    })
  ),
})
type EmailThreadRow = Doc<"receivedEmails"> | Doc<"emailRecipients">
export type ThreadMessage = Omit<Infer<typeof threadMessage>, "normalized"> & {
  normalized?: Awaited<ReturnType<typeof hydratedChannelMessage>> & {
    context?: WhatsAppContext
    referral?: WhatsAppReferral
  }
}
/** A bubble shows the start of a long email; its page has the rest. */
const TEXT_LIMIT = 4000
/** Email bodies are read with their rows, so a page stays small. */
const EMAIL_PAGE = 10

/** A thread's messages, newest first; the inbox shows them oldest first.
    An email thread merges the sender's mail with the team's sends to them. */
export const messages = query({
  args: { id: v.id("conversations"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(threadMessage),
  handler: async (ctx, { id, paginationOpts }) => {
    const conversation = await readTeamRow(ctx, "conversations", id)
    if (!conversation) throw new ConvexError("Conversation not found")
    const org = conversation.organizationId
    const address = conversation.emailAddress
    if (conversation.channel === "email" && address) {
      const result = await mergedStream<EmailThreadRow>(
        [
          stream(ctx.db, schema)
            .query("receivedEmails")
            .withIndex("by_organizationId_and_sender", (q) =>
              q.eq("organizationId", org).eq("sender", address)
            )
            .order("desc") as QueryStream<EmailThreadRow>,
          stream(ctx.db, schema)
            .query("emailRecipients")
            .withIndex("by_organizationId_and_address", (q) =>
              q.eq("organizationId", org).eq("address", address)
            )
            .order("desc") as QueryStream<EmailThreadRow>,
        ],
        ["_creationTime"]
      ).paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, EMAIL_PAGE),
      })
      const page = await Promise.all(
        result.page.map((row) =>
          "emailId" in row
            ? sentEmail(ctx, row.emailId)
            : receivedEmail(ctx, row)
        )
      )
      return {
        ...result,
        page: page.filter((row) => row !== null),
      }
    }
    const result = await ctx.db
      .query("channelMessages")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", id))
      .order("desc")
      .paginate(paginationOpts)
    const account = conversation.accountId
      ? await ctx.db.get("channelAccounts", conversation.accountId)
      : null
    const templateCache: TemplatePageCache = new Map()
    const page = await Promise.all(
      result.page.map(async (message) => {
        const content = await ctx.db
          .query("channelMessageContents")
          .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
          .unique()
        const rendered = await renderedChannelTemplate(
          ctx,
          message,
          content,
          account,
          templateCache
        )
        return {
          id: message._id,
          kind: "channel" as const,
          direction: message.direction,
          at: message._creationTime,
          status: message.status,
          text: rendered?.body ?? bodyText(message, content),
          ...(rendered ? { rendered } : {}),
          ...(message.error
            ? {
                error: message.errorTitle
                  ? `${message.errorTitle}: ${message.error}`
                  : message.error,
              }
            : {}),
          media: mediaFiles(message, content),
          normalized: await hydratedChannelMessage(
            ctx,
            message,
            Date.now(),
            content
          ),
        }
      })
    )
    return { ...result, page }
  },
})

/** A text message's whole body; any other message's preview. */
function bodyText(
  message: Doc<"channelMessages">,
  content: Doc<"channelMessageContents"> | null
) {
  if (!content) return message.preview
  return (
    channelMessagePayload(message, object(JSON.parse(content.payload))).text ??
    message.preview
  )
}

async function receivedEmail(ctx: QueryCtx, row: Doc<"receivedEmails">) {
  const content = await ctx.db
    .query("receivedContents")
    .withIndex("by_emailId", (q) => q.eq("emailId", row._id))
    .unique()
  return {
    id: row._id,
    kind: "received" as const,
    direction: "inbound" as const,
    at: row.receivedAt,
    status: "received",
    subject: row.subject,
    text: (content?.text ?? "").slice(0, TEXT_LIMIT),
    media: [],
  }
}

async function sentEmail(ctx: QueryCtx, id: Id<"emails">) {
  const email = await ctx.db.get("emails", id)
  if (!email) return null
  const content = await ctx.db
    .query("emailContents")
    .withIndex("by_emailId", (q) => q.eq("emailId", id))
    .unique()
  return {
    id: email._id,
    kind: "email" as const,
    direction: "outbound" as const,
    at: email._creationTime,
    status: email.status,
    subject: email.subject,
    text: (content?.text ?? "").slice(0, TEXT_LIMIT),
    ...(email.error ? { error: email.error } : {}),
    media: [],
  }
}

/** The variables an approved WhatsApp template needs when replying on this
    thread's number; null when it cannot be sent from it. */
export const templateVariables = query({
  args: { id: v.id("conversations"), templateId: v.id("templates") },
  returns: v.union(v.null(), v.array(v.string())),
  handler: async (ctx, { id, templateId }) => {
    const conversation = await readTeamRow(ctx, "conversations", id)
    const account = conversation?.accountId
      ? await ctx.db.get("channelAccounts", conversation.accountId)
      : null
    if (!conversation || !account) return null
    try {
      return (
        await resolveWhatsAppTemplate(ctx, conversation.organizationId, {
          id: templateId,
          wabaId: account.wabaId,
        })
      ).variables
    } catch (error) {
      if (error instanceof ConvexError) return null
      throw error
    }
  },
})

/** Published template inputs, including whether its retained sample is usable. */
export const templateInputs = query({
  args: { id: v.id("conversations"), templateId: v.id("templates") },
  returns: v.union(
    v.null(),
    v.object({
      variables: v.array(v.string()),
      header: v.union(
        v.null(),
        v.object({
          format: v.union(
            v.literal("IMAGE"),
            v.literal("VIDEO"),
            v.literal("DOCUMENT")
          ),
          sampleFileId: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, { id, templateId }) => {
    const conversation = await readTeamRow(ctx, "conversations", id)
    const account = conversation?.accountId
      ? await ctx.db.get("channelAccounts", conversation.accountId)
      : null
    if (!conversation || !account) return null
    try {
      const template = await resolveWhatsAppTemplate(
        ctx,
        conversation.organizationId,
        {
          id: templateId,
          wabaId: account.wabaId,
        }
      )
      return {
        variables: template.variables,
        header: templateMediaHeader(storedComponents(template.components)),
      }
    } catch (error) {
      if (error instanceof ConvexError) return null
      throw error
    }
  },
})

async function writableThread(ctx: MutationCtx, id: Id<"conversations">) {
  const conversation = await ctx.db.get("conversations", id)
  if (!conversation) throw new ConvexError("Conversation not found")
  await requireTeam(ctx, conversation.organizationId, "write")
  return conversation
}

export const markRead = mutation({
  args: { id: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const conversation = await writableThread(ctx, id)
    if (conversation.unread || conversation.unreadCount) {
      if (conversation.channel !== "email") {
        const message = await latestInbound(ctx, id)
        if (message) await scheduleControl(ctx, message, true)
      }
      await patchRow(ctx, "conversations", id, {
        unread: false,
        unreadCount: 0,
      })
    }
    return null
  },
})

export const typing = mutation({
  args: { id: v.id("conversations"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, on }) => {
    const conversation = await writableThread(ctx, id)
    if (conversation.channel === "email") return null
    const message = await typingMessage(ctx, conversation)
    if (message) await scheduleControl(ctx, message, false, on)
    return null
  },
})

export const setStatus = mutation({
  args: { id: v.id("conversations"), status: conversationStatusValue },
  returns: v.null(),
  handler: async (ctx, { id, status }) => {
    await writableThread(ctx, id)
    await patchRow(ctx, "conversations", id, { status })
    return null
  },
})

/** Replies on the thread's channel: text, or on WhatsApp an approved
    template with its variables. An email reply needs `from`, a sender on a
    verified domain, and answers the newest received email. The channel's
    own rules apply, like WhatsApp's 24-hour window. */
export const reply = mutation({
  args: {
    fileId: v.optional(v.id("storedFiles")),
    id: v.id("conversations"),
    text: v.optional(v.string()),
    body: v.optional(v.record(v.string(), v.any())),
    template: v.optional(
      v.object({
        id: v.id("templates"),
        variables: v.record(v.string(), v.string()),
        headerFileId: v.optional(v.id("storedFiles")),
      })
    ),
    from: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { id, text, template, from, fileId, body }) => {
    const conversation = await writableThread(ctx, id)
    const organizationId = conversation.organizationId
    if (!text?.trim() && !template && !fileId && !body)
      throw new ConvexError("Write a message or choose a template")
    try {
      if (conversation.channel === "email") {
        if (body)
          throw new ConvexError(
            "Interactive messages require a messaging channel"
          )
        const address = conversation.emailAddress
        if (!address || !text?.trim()) throw new ConvexError("Write a message")
        const last = await lastReceived(ctx, conversation)
        const emailId = await createEmail(
          ctx,
          {
            from,
            to: [address],
            cc: [],
            bcc: [],
            replyTo: [],
            subject: replySubject(last?.subject),
            text,
            headers: replyHeaders(last?.messageId),
            attachments: fileId
              ? [
                  await (async () => {
                    const file = await ctx.db.get("storedFiles", fileId)
                    if (
                      !file ||
                      file.organizationId !== organizationId ||
                      file.feature !== "email" ||
                      file.state !== "ready"
                    )
                      throw new ConvexError("Attachment is not ready")
                    return {
                      fileId,
                      filename: file.filename ?? "attachment",
                      contentType: file.contentType,
                      size: file.size,
                    }
                  })(),
                ]
              : [],
            tags: [],
          },
          { organizationId, source: "dashboard" }
        )
        await upsertEmailThread(ctx, {
          organizationId,
          address,
          at: Date.now(),
          preview: text.slice(0, 1000),
          direction: "outbound",
        })
        return emailId
      }
      const identity = conversation.channelContactId
        ? await ctx.db.get("channelContacts", conversation.channelContactId)
        : null
      if (!conversation.accountId || !identity)
        throw new ConvexError("Conversation not found")
      return await createChannelMessage(
        ctx,
        {
          channel: conversation.channel,
          from: conversation.accountId,
          to: identity.externalId,
          body:
            body ??
            (fileId
              ? await (async () => {
                  const file = await ctx.db.get("storedFiles", fileId)
                  if (!file || conversation.channel !== "whatsapp")
                    throw new ConvexError(
                      "File replies are supported for WhatsApp and email"
                    )
                  const kind =
                    file.contentType === "image/webp"
                      ? "sticker"
                      : file.contentType.startsWith("image/")
                        ? "image"
                        : file.contentType.startsWith("video/")
                          ? "video"
                          : file.contentType.startsWith("audio/")
                            ? "audio"
                            : "document"
                  return {
                    type: kind,
                    [kind]: {
                      id: fileId,
                      ...(kind === "document"
                        ? { filename: file.filename }
                        : {}),
                      ...(["image", "video", "document"].includes(kind) &&
                      text?.trim()
                        ? { caption: text.trim() }
                        : {}),
                    },
                  }
                })()
              : template
                ? {
                    type: "template",
                    template: {
                      id: template.id,
                      variables: {
                        ...template.variables,
                        ...(template.headerFileId
                          ? {
                              header_media: `opensend-file:${template.headerFileId}`,
                            }
                          : {}),
                      },
                    },
                  }
                : channelStrategies[conversation.channel].replyBody(text!)),
        },
        { organizationId, source: "dashboard" }
      )
    } catch (error) {
      // The dashboard shows the message, not the REST error object.
      const message = errorMessage(error)
      if (message) throw new ConvexError(message)
      throw error
    }
  },
})

/** Open a compose destination without pretending a customer wrote to us.
 * Existing threads retain their preview, unread state and service window. */
export const start = mutation({
  args: {
    organizationId: v.string(),
    contactId: v.id("contacts"),
    channel: channelValue,
    accountId: v.optional(v.id("channelAccounts")),
  },
  returns: v.id("conversations"),
  handler: async (ctx, { organizationId, contactId, channel, accountId }) => {
    await requireTeam(ctx, organizationId, "write")
    const contact = await teamRow(ctx, "contacts", organizationId, contactId)
    if (channel === "email") {
      if (!contact.email)
        throw new ConvexError("This contact has no email address")
      const existing = await ctx.db
        .query("conversations")
        .withIndex("by_organizationId_and_emailAddress", (q) =>
          q
            .eq("organizationId", organizationId)
            .eq("emailAddress", contact.email!)
        )
        .unique()
      if (existing) return existing._id
      return await upsertEmailThread(ctx, {
        organizationId,
        address: contact.email,
        at: Date.now(),
        direction: "outbound",
        preview: "",
      })
    }
    if (!accountId) throw new ConvexError("Choose a sending account")
    const { account, connection } = await channelAccountAccess(
      ctx,
      organizationId,
      accountId,
      channel
    )
    const identities = await ctx.db
      .query("channelContacts")
      .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
      .take(100)
    const identity = identities.find(
      (row) =>
        row.organizationId === organizationId &&
        row.channel === channel &&
        (channel === "whatsapp"
          ? !!row.phone || row.userScopeId === connection.businessId
          : row.scopeId === account.externalId)
    )
    if (!identity && (channel !== "whatsapp" || !contact.phone))
      throw new ConvexError(
        `This contact has no ${channel} identity for this account`
      )
    if (identity) {
      const existing = await ctx.db
        .query("conversations")
        .withIndex("by_accountId_and_channelContactId", (q) =>
          q.eq("accountId", account._id).eq("channelContactId", identity._id)
        )
        .unique()
      if (existing) return existing._id
    }
    const phone =
      identity?.phone ?? (channel === "whatsapp" ? contact.phone : undefined)
    const result = await upsertChannelThread(ctx, account, {
      externalId: phone ? toWaId(phone)! : identity!.externalId,
      ...(phone ? { phone } : {}),
      ...(identity?.userId ? { userId: identity.userId } : {}),
      profileName: [contact.firstName, contact.lastName]
        .filter(Boolean)
        .join(" "),
      at: Date.now(),
      direction: "outbound",
      preview: "",
    })
    return result.conversationId
  },
})
