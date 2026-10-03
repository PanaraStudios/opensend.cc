import {
  messageContentPreview,
  relativeMessageTime,
} from "../../lib/dashboard/conversation-content"
import { object } from "../../lib/meta/parse"
import {
  CallerContextTimeout,
  CALLER_CONTEXT_NOTE_COUNT,
  callerContextNoteLines,
  callerContextPastDeadline,
  type CallerLookup,
} from "../../lib/voice-caller-context"
import { channelMessagePayload } from "../channels/payload"
import { renderedChannelTemplate } from "../channels/templates"
import { resolveCallPerson } from "../channels/identity"
import type { Doc } from "../_generated/dataModel"
import type { QueryCtx } from "../_generated/server"

function guard(deadline: number) {
  if (callerContextPastDeadline(deadline)) throw new CallerContextTimeout()
}

/** The same caller record lookup_contact returns, including the newest contact notes. */
export async function lookupContact(
  ctx: QueryCtx,
  call: Doc<"calls">,
  deadline = Number.POSITIVE_INFINITY
): Promise<CallerLookup> {
  guard(deadline)
  const { contact, conversationId, phone } = await resolveCallPerson(ctx, call)
  guard(deadline)
  if (!contact || contact.organizationId !== call.organizationId)
    return { found: false, phone: phone ?? null }
  const messages = conversationId
    ? await ctx.db
        .query("channelMessages")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", conversationId)
        )
        .order("desc")
        .take(5)
    : []
  guard(deadline)
  const now = Date.now()
  const account = await ctx.db.get("channelAccounts", call.accountId)
  const previews = await Promise.all(
    messages
      .filter((message) => message.organizationId === call.organizationId)
      .map(async (message) => {
        const content = await ctx.db
          .query("channelMessageContents")
          .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
          .unique()
        const normalized = channelMessagePayload(
          message,
          object(JSON.parse(content?.payload ?? "{}"))
        )
        const rendered = await renderedChannelTemplate(
          ctx,
          message,
          content,
          account
        )
        const preview = message.revokedAt
          ? "Message deleted"
          : messageContentPreview(
              message.type,
              normalized.content,
              message.preview,
              rendered
            )
        return `${message.direction === "inbound" ? "Customer" : "Business"} (${relativeMessageTime(message.observedAt ?? message._creationTime, now)}): ${preview.slice(0, 600)}`
      })
  )
  guard(deadline)
  const members = await ctx.db
    .query("segmentMembers")
    .withIndex("by_contactId", (q) => q.eq("contactId", contact._id))
    .take(100)
  const segments = await Promise.all(
    members
      .filter((member) => member.organizationId === call.organizationId)
      .map((member) => ctx.db.get("segments", member.segmentId))
  )
  guard(deadline)
  const identities = await ctx.db
    .query("channelContacts")
    .withIndex("by_contactId", (q) => q.eq("contactId", contact._id))
    .take(100)
  guard(deadline)
  const noteRows = await ctx.db
    .query("contactNotes")
    .withIndex("by_organizationId_and_contactId", (q) =>
      q
        .eq("organizationId", call.organizationId)
        .eq("contactId", contact._id)
    )
    .order("desc")
    .take(CALLER_CONTEXT_NOTE_COUNT)
  guard(deadline)
  return {
    found: true,
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    properties: contact.properties,
    tags: segments
      .filter((segment) => segment?.organizationId === call.organizationId)
      .map((segment) => segment!.name),
    channelIdentities: identities
      .filter(
        (identity) =>
          identity.organizationId === call.organizationId &&
          !identity.mergedIntoId
      )
      .map((identity) => ({
        channel: identity.channel,
        externalId: identity.externalId,
        scopeId: identity.scopeId,
        phone: identity.phone ?? null,
        userId: identity.userId ?? null,
        parentUserId: identity.parentUserId ?? null,
        username: identity.username ?? null,
        profileName: identity.profileName ?? null,
      })),
    recentMessageSummary: previews.join("\n").slice(0, 3500),
    notes: callerContextNoteLines(
      noteRows
        .filter((note) => note.organizationId === call.organizationId)
        .map((note) => note.body)
    ),
  }
}
