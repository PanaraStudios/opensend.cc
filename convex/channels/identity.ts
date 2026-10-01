import { toWaId, fromWaId, normalizePhone } from "../../lib/dashboard/phone"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { upsertContact, insertContact, patchContact } from "../audience"
import { insertRow, patchRow } from "../counts"
import { profileNameParts } from "../../lib/meta/webhooks"

/** One team identity per wa_id, PSID or IGSID (Page and Instagram ids are
 * scoped to their account), and one thread per identity and account.
 * Outbound sends never open the customer service window or increment unread. */
export async function upsertChannelThread(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  input: ThreadMessage & {
    externalId: string
    phone?: string
    profileName?: string
    userId?: string
    parentUserId?: string
    username?: string
    identityKeyHash?: string
  }
) {
  const { externalId, phone, profileName = "", at, direction } = input
  const userScopeId = input.userId
    ? (await ctx.db.get("metaConnections", account.connectionId))?.businessId
    : undefined
  const scopeId =
    account.channel === "whatsapp"
      ? phone
        ? "whatsapp"
        : `whatsapp:${userScopeId ?? account.connectionId}`
      : account.externalId
  const alias =
    input.userId && userScopeId
      ? await ctx.db
          .query("whatsappUserAliases")
          .withIndex("by_organizationId_and_businessId_and_userId", (q) =>
            q
              .eq("organizationId", account.organizationId)
              .eq("businessId", userScopeId)
              .eq("userId", input.userId!)
          )
          .unique()
      : null
  const aliasedIdentity = alias
    ? await ctx.db.get("channelContacts", alias.channelContactId)
    : null
  const identity =
    aliasedIdentity ??
    (await ctx.db
      .query("channelContacts")
      .withIndex(
        "by_organizationId_and_channel_and_scopeId_and_externalId",
        (q) =>
          q
            .eq("organizationId", account.organizationId)
            .eq("channel", account.channel)
            .eq("scopeId", scopeId)
            .eq("externalId", externalId)
      )
      .unique())
  const linked = identity?.contactId
    ? await ctx.db.get("contacts", identity.contactId)
    : null
  const contactId =
    linked?.organizationId === account.organizationId
      ? linked._id
      : !phone
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
  if (
    phone &&
    linked?.organizationId === account.organizationId &&
    !linked.phone
  ) {
    const existingPhone = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId_and_phone", (q) =>
        q.eq("organizationId", account.organizationId).eq("phone", phone)
      )
      .first()
    if (!existingPhone || existingPhone._id === linked._id)
      await patchContact(ctx, linked, { phone }, at)
  }
  const changes = {
    contactId,
    ...(phone ? { phone, externalId, scopeId: "whatsapp" } : {}),
    ...(input.userId ? { userId: input.userId, userScopeId } : {}),
    ...(input.parentUserId ? { parentUserId: input.parentUserId } : {}),
    ...(input.username ? { username: input.username } : {}),
    ...(input.identityKeyHash
      ? { identityKeyHash: input.identityKeyHash }
      : {}),
    ...(profileName ? { profileName } : {}),
    ...(direction === "inbound" && input.opensWindow !== false
      ? { lastInboundAt: Math.max(at, identity?.lastInboundAt ?? 0) }
      : {}),
  }
  let channelContactId
  if (identity) {
    if (
      Object.entries(changes).some(
        ([key, value]) => identity[key as keyof typeof changes] !== value
      )
    )
      await ctx.db.patch("channelContacts", identity._id, changes)
    channelContactId = identity._id
  } else
    channelContactId = await ctx.db.insert("channelContacts", {
      organizationId: account.organizationId,
      channel: account.channel,
      scopeId,
      externalId,
      marketingOptOut: false,
      ...changes,
    })
  if (input.userId && userScopeId)
    await recordWhatsAppUser(
      ctx,
      account,
      channelContactId,
      input.userId,
      input
    )
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_accountId_and_channelContactId", (q) =>
      q.eq("accountId", account._id).eq("channelContactId", channelContactId)
    )
    .unique()
  const conversationId = await saveThread(ctx, conversation, {
    organizationId: account.organizationId,
    channel: account.channel,
    accountId: account._id,
    channelContactId,
    contactId,
    ...threadChanges(conversation, input),
    ...(direction === "inbound" && input.opensWindow !== false
      ? {
          windowExpiresAt:
            Math.max(at, conversation?.lastInboundAt ?? 0) + 24 * 3600_000,
        }
      : {}),
    search: conversationSearch(
      phone ?? externalId,
      profileName || identity?.profileName
    ),
  })
  return { contactId, channelContactId, conversationId }
}

type ThreadMessage = {
  at: number
  preview: string
  direction: "inbound" | "outbound"
  opensWindow?: boolean
}

/** What one more message changes on its thread, on any channel: a reply
    from the person reopens it and counts as unread; the newest message
    is the thread's preview. Sends never mark a thread unread. */
function threadChanges(
  conversation: Doc<"conversations"> | null,
  { at, preview, direction, opensWindow }: ThreadMessage
) {
  return {
    ...(direction === "inbound"
      ? {
          status: "open" as const,
          ...(opensWindow !== false
            ? { lastInboundAt: Math.max(at, conversation?.lastInboundAt ?? 0) }
            : {}),
          unread: true,
          unreadCount:
            (conversation?.unreadCount ?? (conversation?.unread ? 1 : 0)) + 1,
        }
      : {}),
    ...(!conversation || at >= conversation.lastMessageAt
      ? { lastMessageAt: at, lastPreview: preview, lastDirection: direction }
      : {}),
  }
}

/** Patches the thread, or opens it with the message as its first. */
async function saveThread(
  ctx: MutationCtx,
  conversation: Doc<"conversations"> | null,
  fields: Pick<Doc<"conversations">, "organizationId" | "channel"> &
    Partial<Omit<Doc<"conversations">, "_id" | "_creationTime">> & {
      search: string
    }
): Promise<Id<"conversations">> {
  if (conversation)
    return (await patchRow(ctx, "conversations", conversation._id, fields))._id
  return (
    await insertRow(
      ctx,
      "conversations",
      {
        status: "open",
        unread: false,
        lastMessageAt: 0,
        lastPreview: "",
        lastDirection: "outbound",
        ...fields,
      },
      true
    )
  )._id
}

/** One email thread per team and sender address, linked to the contact
    with that email when there is one. Received mail and replies sent from
    the inbox call it; other sends leave threads alone. */
export async function upsertEmailThread(
  ctx: MutationCtx,
  input: ThreadMessage & {
    organizationId: string
    address: string
    /** The sender's display name, for search. */
    name?: string
  }
) {
  const { organizationId } = input
  const address = input.address.trim().toLowerCase()
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_organizationId_and_emailAddress", (q) =>
      q.eq("organizationId", organizationId).eq("emailAddress", address)
    )
    .first()
  const contact = await ctx.db
    .query("contacts")
    .withIndex("by_organizationId_and_email", (q) =>
      q.eq("organizationId", organizationId).eq("email", address)
    )
    .first()
  return saveThread(ctx, conversation, {
    organizationId,
    channel: "email",
    emailAddress: address,
    ...(contact ? { contactId: contact._id } : {}),
    ...threadChanges(conversation, input),
    // A send carries no name; the thread keeps the one mail gave it.
    search:
      conversation && !input.name
        ? conversation.search
        : [address, input.name, contact?.firstName, contact?.lastName]
            .filter(Boolean)
            .join(" "),
  })
}

export const conversationSearch = (handle: string, name?: string) =>
  [handle, name].join(" ")

/** WhatsApp identities are team scoped and shared across sending numbers. */
export const findWhatsAppIdentity = (
  ctx: QueryCtx,
  organizationId: string,
  phone: string
) =>
  ctx.db
    .query("channelContacts")
    .withIndex(
      "by_organizationId_and_channel_and_scopeId_and_externalId",
      (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("channel", "whatsapp")
          .eq("scopeId", "whatsapp")
          .eq("externalId", toWaId(phone))
    )
    .unique()

/** PSIDs/IGSIDs belong to one Page/account, even for a linked CRM contact. */
export async function findPageIdentity(
  ctx: QueryCtx,
  account: Doc<"channelAccounts">,
  contactId: Id<"contacts">
) {
  for await (const identity of ctx.db
    .query("channelContacts")
    .withIndex("by_contactId", (q) => q.eq("contactId", contactId))) {
    if (
      identity.organizationId === account.organizationId &&
      identity.channel === account.channel &&
      identity.scopeId === account.externalId
    )
      return identity
  }
  return null
}

/** Keep every business alias, rather than overwriting another business's BSUID. */
export async function recordWhatsAppUser(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  channelContactId: Id<"channelContacts">,
  userId: string,
  profile: {
    parentUserId?: string
    username?: string
    identityKeyHash?: string
  } = {}
) {
  const connection = await ctx.db.get("metaConnections", account.connectionId)
  if (!connection || account.channel !== "whatsapp") return
  const existing = await ctx.db
    .query("whatsappUserAliases")
    .withIndex("by_organizationId_and_businessId_and_userId", (q) =>
      q
        .eq("organizationId", account.organizationId)
        .eq("businessId", connection.businessId)
        .eq("userId", userId)
    )
    .unique()
  const fields = {
    organizationId: account.organizationId,
    businessId: connection.businessId,
    userId,
    channelContactId,
    ...(profile.parentUserId ? { parentUserId: profile.parentUserId } : {}),
    ...(profile.username ? { username: profile.username } : {}),
    ...(profile.identityKeyHash
      ? { identityKeyHash: profile.identityKeyHash }
      : {}),
  }
  if (existing) await ctx.db.patch("whatsappUserAliases", existing._id, fields)
  else await ctx.db.insert("whatsappUserAliases", fields)
  await ctx.db.patch("channelContacts", channelContactId, {
    userId,
    userScopeId: connection.businessId,
    ...(profile.parentUserId ? { parentUserId: profile.parentUserId } : {}),
    ...(profile.username ? { username: profile.username } : {}),
    ...(profile.identityKeyHash
      ? { identityKeyHash: profile.identityKeyHash }
      : {}),
  })
}

/** Link a phone learned from Meta without replacing an existing CRM identity. */
export async function recordWhatsAppPhone(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  channelContactId: Id<"channelContacts">,
  waId: string
) {
  const phone = normalizePhone(fromWaId(waId))
  if (!phone) return
  const identity = await ctx.db.get("channelContacts", channelContactId)
  if (!identity || identity.organizationId !== account.organizationId) return
  const other = await ctx.db
    .query("channelContacts")
    .withIndex(
      "by_organizationId_and_channel_and_scopeId_and_externalId",
      (q) =>
        q
          .eq("organizationId", account.organizationId)
          .eq("channel", "whatsapp")
          .eq("scopeId", "whatsapp")
          .eq("externalId", phone.slice(1))
    )
    .first()
  if (other && other._id !== channelContactId) return
  await ctx.db.patch("channelContacts", channelContactId, {
    phone,
    externalId: phone.slice(1),
    scopeId: "whatsapp",
  })
  const contact = identity.contactId
    ? await ctx.db.get("contacts", identity.contactId)
    : null
  const phoneOwner = await ctx.db
    .query("contacts")
    .withIndex("by_organizationId_and_phone", (q) =>
      q.eq("organizationId", account.organizationId).eq("phone", phone)
    )
    .first()
  if (
    contact?.organizationId === account.organizationId &&
    !contact.phone &&
    (!phoneOwner || phoneOwner._id === contact._id)
  )
    await patchContact(ctx, contact, { phone })
}
