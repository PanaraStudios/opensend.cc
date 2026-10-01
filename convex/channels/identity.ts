import type { MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { upsertContact, insertContact } from "../audience"
import { insertRow, patchRow } from "../counts"
import { profileNameParts } from "../../lib/meta/webhooks"

/** One team identity per wa_id, and one thread per identity and number.
 * Outbound sends never open the customer service window or increment unread. */
export async function upsertChannelThread(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  input: {
    externalId: string
    phone?: string
    profileName?: string
    at: number
    preview: string
    direction: "inbound" | "outbound"
  }
) {
  const { externalId, phone, profileName = "", at, preview, direction } = input
  const identity = await ctx.db
    .query("channelContacts")
    .withIndex(
      "by_organizationId_and_channel_and_scopeId_and_externalId",
      (q) =>
        q
          .eq("organizationId", account.organizationId)
          .eq("channel", account.channel)
          .eq(
            "scopeId",
            account.channel === "whatsapp" ? "whatsapp" : account.externalId
          )
          .eq("externalId", externalId)
    )
    .unique()
  const linked = identity?.contactId
    ? await ctx.db.get("contacts", identity.contactId)
    : null
  const contactId =
    linked?.organizationId === account.organizationId
      ? linked._id
      : account.channel !== "whatsapp"
        ? await insertContact(
            ctx,
            account.organizationId,
            profileNameParts(profileName)
          )
        : (
            await upsertContact(
              ctx,
              account.organizationId,
              { phone, ...profileNameParts(profileName) },
              { properties: [], segmentIds: [], skipExisting: true }
            )
          ).id
  const changes = {
    contactId,
    phone,
    ...(profileName ? { profileName } : {}),
    ...(direction === "inbound"
      ? { lastInboundAt: Math.max(at, identity?.lastInboundAt ?? 0) }
      : {}),
  }
  let channelContactId
  if (identity) {
    await ctx.db.patch("channelContacts", identity._id, changes)
    channelContactId = identity._id
  } else
    channelContactId = await ctx.db.insert("channelContacts", {
      organizationId: account.organizationId,
      channel: account.channel,
      scopeId: account.channel === "whatsapp" ? "whatsapp" : account.externalId,
      externalId,
      marketingOptOut: false,
      ...changes,
    })
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_accountId_and_channelContactId", (q) =>
      q.eq("accountId", account._id).eq("channelContactId", channelContactId)
    )
    .unique()
  const lastInboundAt = Math.max(at, conversation?.lastInboundAt ?? 0)
  const conversationChanges = {
    contactId,
    ...(direction === "inbound"
      ? {
          lastInboundAt,
          windowExpiresAt: lastInboundAt + 24 * 3600_000,
          unread: true,
          unreadCount:
            (conversation?.unreadCount ?? (conversation?.unread ? 1 : 0)) + 1,
        }
      : {}),
    ...(!conversation || at >= conversation.lastMessageAt
      ? {
          lastMessageAt: at,
          lastPreview: preview,
          lastDirection: direction,
        }
      : {}),
    search: [phone ?? externalId, profileName || identity?.profileName].join(
      " "
    ),
  }
  const conversationId = conversation
    ? (
        await patchRow(
          ctx,
          "conversations",
          conversation._id,
          conversationChanges
        )
      )._id
    : (
        await insertRow(
          ctx,
          "conversations",
          {
            organizationId: account.organizationId,
            channel: account.channel,
            accountId: account._id,
            channelContactId,
            status: "open",
            lastMessageAt: at,
            lastPreview: preview,
            lastDirection: direction,
            unread: false,
            ...conversationChanges,
          },
          true
        )
      )._id
  return { contactId, channelContactId, conversationId }
}

/** Preserve the WhatsApp entry point for existing callers. */
export const upsertWhatsAppThread = upsertChannelThread
