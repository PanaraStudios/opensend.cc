import { toWaId, fromWaId, normalizePhone } from "../../lib/dashboard/phone"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { upsertContact, insertContact, patchContact } from "../audience"
import { insertRow, patchRow, deleteRow } from "../counts"
import { internalMutation } from "../_generated/server"
import { internal } from "../_generated/api"
import { v } from "convex/values"
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
    refreshThread?: boolean
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
  const byUser =
    input.userId && account.channel === "whatsapp"
      ? await findWhatsAppUserIdentity(ctx, account, input.userId)
      : null
  const byExternal = await ctx.db
    .query("channelContacts")
    .withIndex(
      "by_organizationId_and_channel_and_scopeId_and_externalId",
      (q) =>
        q
          .eq("organizationId", account.organizationId)
          .eq("channel", account.channel)
          .eq("scopeId", scopeId)
          .eq("externalId", phone ? toWaId(phone) : externalId)
    )
    .unique()
  let identity = phone ? (byExternal ?? byUser) : (byUser ?? byExternal)
  if (byExternal && byUser && byExternal._id !== byUser._id) {
    const target = phone ? byExternal : byUser
    const source = phone ? byUser : byExternal
    if (target.phone) {
      await mergeWhatsAppIdentities(ctx, source, target)
      identity = (await ctx.db.get("channelContacts", target._id))!
    }
  }
  const linked = identity?.contactId
    ? await ctx.db.get("contacts", identity.contactId)
    : null
  const phoneOwner = phone
    ? await ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_phone", (q) =>
          q.eq("organizationId", account.organizationId).eq("phone", phone)
        )
        .first()
    : null
  const contactId =
    phoneOwner?._id ??
    (linked?.organizationId === account.organizationId
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
          ).id)
  if (
    phone &&
    linked?.organizationId === account.organizationId &&
    !linked.phone
  ) {
    if (!phoneOwner || phoneOwner._id === linked._id)
      await patchContact(ctx, linked, { phone }, at)
  }
  const changes = {
    contactId,
    ...(phone ? { phone, externalId: toWaId(phone), scopeId: "whatsapp" } : {}),
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
    if (identity.contactId !== contactId)
      await ctx.scheduler.runAfter(0, internal.channels.identity.relinkCalls, {
        channelContactId,
        cursor: null,
      })
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
    ...(conversation && input.refreshThread === false
      ? {}
      : threadChanges(conversation, input)),
    ...(direction === "inbound" && input.opensWindow !== false
      ? {
          windowExpiresAt:
            Math.max(at, conversation?.lastInboundAt ?? 0) + 24 * 3600_000,
        }
      : {}),
    search: conversationSearch(
      phone ?? identity?.phone ?? externalId,
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
  if (other && other._id !== channelContactId) {
    await mergeWhatsAppIdentities(ctx, identity, other)
    return
  }
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

/** Resolve business aliases first, then pre-alias rows written by older webhooks. */
export async function findWhatsAppUserIdentity(
  ctx: QueryCtx,
  account: Doc<"channelAccounts">,
  userId: string
): Promise<Doc<"channelContacts"> | null> {
  const connection = await ctx.db.get("metaConnections", account.connectionId)
  if (account.channel !== "whatsapp" || !connection) return null
  const alias = await ctx.db
    .query("whatsappUserAliases")
    .withIndex("by_organizationId_and_businessId_and_userId", (q) =>
      q
        .eq("organizationId", account.organizationId)
        .eq("businessId", connection.businessId)
        .eq("userId", userId)
    )
    .unique()
  let identity = alias
    ? await ctx.db.get("channelContacts", alias.channelContactId)
    : null
  if (!identity?.phone) {
    const candidates = await ctx.db
      .query("channelContacts")
      .withIndex("by_organizationId_and_channel_and_userId", (q) =>
        q
          .eq("organizationId", account.organizationId)
          .eq("channel", "whatsapp")
          .eq("userId", userId)
      )
      .take(20)
    const inScope = candidates.filter(
      (row) =>
        row.userScopeId === connection.businessId ||
        (!row.userScopeId &&
          (row.scopeId === "whatsapp" ||
            row.scopeId === `whatsapp:${connection.businessId}` ||
            row.scopeId === `whatsapp:${account.connectionId}`))
    )
    identity =
      inScope.find((row) => row.phone && !row.mergedIntoId) ??
      identity ??
      inScope[0] ??
      null
  }
  if (identity?.mergedIntoId)
    identity = await ctx.db.get("channelContacts", identity.mergedIntoId)
  return identity?.organizationId === account.organizationId &&
    identity.channel === "whatsapp"
    ? identity
    : null
}

async function mergeWhatsAppIdentities(
  ctx: MutationCtx,
  source: Doc<"channelContacts">,
  target: Doc<"channelContacts">
) {
  if (source._id === target._id || source.mergedIntoId === target._id) return
  if (
    source.organizationId !== target.organizationId ||
    source.channel !== "whatsapp" ||
    target.channel !== "whatsapp"
  )
    throw new Error("Identity scope mismatch")
  await ctx.db.patch("channelContacts", target._id, {
    contactId: target.contactId ?? source.contactId,
    profileName: target.profileName || source.profileName,
    username: target.username || source.username,
    userId: source.userId ?? target.userId,
    userScopeId: source.userScopeId ?? target.userScopeId,
    parentUserId: source.parentUserId ?? target.parentUserId,
    identityKeyHash: source.identityKeyHash ?? target.identityKeyHash,
    profileLookedUpAt: Math.max(
      source.profileLookedUpAt ?? 0,
      target.profileLookedUpAt ?? 0
    ),
    marketingOptOut: source.marketingOptOut || target.marketingOptOut,
    lastInboundAt: Math.max(
      source.lastInboundAt ?? 0,
      target.lastInboundAt ?? 0
    ),
  })
  // Retain both CRM documents: either may contain audience properties or subscriptions.
  await ctx.db.patch("channelContacts", source._id, {
    mergedIntoId: target._id,
  })
  await ctx.scheduler.runAfter(0, internal.channels.identity.finishMerge, {
    sourceId: source._id,
    targetId: target._id,
  })
}

/** Bounded, retry-safe reparenting preserves call/message history and thread metadata. */
export const finishMerge = internalMutation({
  args: {
    sourceId: v.id("channelContacts"),
    targetId: v.id("channelContacts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await ctx.db.get("channelContacts", args.sourceId)
    const target = await ctx.db.get("channelContacts", args.targetId)
    if (
      !source ||
      !target ||
      source.mergedIntoId !== target._id ||
      source.organizationId !== target.organizationId
    )
      return null
    const again = async () => {
      await ctx.scheduler.runAfter(
        0,
        internal.channels.identity.finishMerge,
        args
      )
      return null
    }
    const aliases = await ctx.db
      .query("whatsappUserAliases")
      .withIndex("by_channelContactId_and_businessId", (q) =>
        q.eq("channelContactId", source._id)
      )
      .take(100)
    for (const alias of aliases)
      await ctx.db.patch("whatsappUserAliases", alias._id, {
        channelContactId: target._id,
      })
    if (aliases.length === 100) return again()
    const thread = await ctx.db
      .query("conversations")
      .withIndex("by_channelContactId", (q) =>
        q.eq("channelContactId", source._id)
      )
      .first()
    if (thread) {
      const existing = await ctx.db
        .query("conversations")
        .withIndex("by_accountId_and_channelContactId", (q) =>
          q.eq("accountId", thread.accountId).eq("channelContactId", target._id)
        )
        .unique()
      const conversationId = existing?._id ?? thread._id
      const messages = await ctx.db
        .query("channelMessages")
        .withIndex("by_conversationId_and_channelContactId", (q) =>
          existing
            ? q.eq("conversationId", thread._id)
            : q
                .eq("conversationId", thread._id)
                .eq("channelContactId", source._id)
        )
        .take(100)
      for (const message of messages)
        await patchRow(ctx, "channelMessages", message._id, {
          channelContactId: target._id,
          conversationId,
        })
      const calls = await ctx.db
        .query("calls")
        .withIndex("by_conversationId_and_channelContactId", (q) =>
          existing
            ? q.eq("conversationId", thread._id)
            : q
                .eq("conversationId", thread._id)
                .eq("channelContactId", source._id)
        )
        .take(100)
      for (const call of calls)
        await ctx.db.patch("calls", call._id, {
          channelContactId: target._id,
          contactId: target.contactId,
          conversationId,
        })
      if (messages.length === 100 || calls.length === 100) return again()
      if (!existing) {
        await patchRow(ctx, "conversations", thread._id, {
          channelContactId: target._id,
          contactId: target.contactId,
        })
      } else {
        await patchRow(ctx, "conversations", existing._id, {
          contactId: target.contactId,
          status:
            existing.status === "open" || thread.status === "open"
              ? "open"
              : "closed",
          unread: existing.unread || thread.unread,
          unreadCount:
            (existing.unreadCount ?? Number(existing.unread)) +
            (thread.unreadCount ?? Number(thread.unread)),
          lastInboundAt: Math.max(
            existing.lastInboundAt ?? 0,
            thread.lastInboundAt ?? 0
          ),
          windowExpiresAt: Math.max(
            existing.windowExpiresAt ?? 0,
            thread.windowExpiresAt ?? 0
          ),
          ...(thread.lastMessageAt > existing.lastMessageAt
            ? {
                lastMessageAt: thread.lastMessageAt,
                lastPreview: thread.lastPreview,
                lastDirection: thread.lastDirection,
              }
            : {}),
        })
        await deleteRow(ctx, "conversations", thread._id)
      }
      return again()
    }
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_channelContactId", (q) =>
        q.eq("channelContactId", source._id)
      )
      .take(100)
    for (const call of calls)
      await ctx.db.patch("calls", call._id, {
        channelContactId: target._id,
        contactId: target.contactId,
      })
    if (calls.length === 100) return again()
    await ctx.db.delete("channelContacts", source._id)
    return null
  },
})

/** Resolve the person, independently of whether an older call stored its links. */
export async function resolveCallPerson(ctx: QueryCtx, call: Doc<"calls">) {
  const account = await ctx.db.get("channelAccounts", call.accountId)
  let identity = call.channelContactId
    ? await ctx.db.get("channelContacts", call.channelContactId)
    : null
  if (
    identity?.organizationId !== call.organizationId ||
    identity?.channel !== "whatsapp"
  )
    identity = null
  if (identity?.mergedIntoId)
    identity = await ctx.db.get("channelContacts", identity.mergedIntoId)
  if (account?.organizationId === call.organizationId && call.userId) {
    identity =
      (await findWhatsAppUserIdentity(ctx, account, call.userId)) ?? identity
  }
  const wirePhone = call.direction === "inbound" ? call.from : call.to
  const phone =
    identity?.phone ?? (wirePhone ? normalizePhone(fromWaId(wirePhone)) : null)
  if (!identity && phone)
    identity = await findWhatsAppIdentity(ctx, call.organizationId, phone)
  let contact = call.contactId
    ? await ctx.db.get("contacts", call.contactId)
    : null
  if (contact?.organizationId !== call.organizationId) contact = null
  if (
    identity?.contactId &&
    (!contact || (call.channelContactId && contact._id !== identity.contactId))
  )
    contact = await ctx.db.get("contacts", identity.contactId)
  if (contact?.organizationId !== call.organizationId) contact = null
  if (!contact && phone)
    contact = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId_and_phone", (q) =>
        q.eq("organizationId", call.organizationId).eq("phone", phone)
      )
      .first()
  if (contact?.organizationId !== call.organizationId) contact = null
  const conversation = identity
    ? await ctx.db
        .query("conversations")
        .withIndex("by_accountId_and_channelContactId", (q) =>
          q.eq("accountId", call.accountId).eq("channelContactId", identity._id)
        )
        .unique()
    : null
  return {
    identity,
    contact,
    phone: contact?.phone ?? identity?.phone ?? phone,
    conversationId: conversation?._id ?? call.conversationId,
  }
}

/** A phone observation can replace a temporary CRM link without changing the identity id. */
export const relinkCalls = internalMutation({
  args: {
    channelContactId: v.id("channelContacts"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.db.get("channelContacts", args.channelContactId)
    if (!identity || identity.mergedIntoId) return null
    const page = await ctx.db
      .query("calls")
      .withIndex("by_channelContactId", (q) =>
        q.eq("channelContactId", identity._id)
      )
      .paginate({ cursor: args.cursor, numItems: 100 })
    for (const call of page.page) {
      if (
        call.organizationId === identity.organizationId &&
        call.contactId !== identity.contactId
      )
        await ctx.db.patch("calls", call._id, { contactId: identity.contactId })
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.channels.identity.relinkCalls, {
        ...args,
        cursor: page.continueCursor,
      })
    return null
  },
})

/** Repair older calls through the same identity/thread path as incoming calls. */
export async function resolveOrCreateCallPerson(
  ctx: MutationCtx,
  call: Doc<"calls">
) {
  const person = await resolveCallPerson(ctx, call)
  if (person.contact) return person
  const account = await ctx.db.get("channelAccounts", call.accountId)
  if (
    account?.organizationId !== call.organizationId ||
    account.channel !== "whatsapp" ||
    (!person.phone && !call.userId && !person.identity)
  )
    return person
  const links = await upsertChannelThread(ctx, account, {
    externalId: person.phone
      ? toWaId(person.phone)
      : (person.identity?.externalId ?? call.userId!),
    ...(person.phone ? { phone: person.phone } : {}),
    ...(call.userId ? { userId: call.userId } : {}),
    profileName: person.identity?.profileName,
    at: Date.now(),
    direction: "outbound",
    opensWindow: false,
    refreshThread: false,
    preview: "Voice call",
  })
  return resolveCallPerson(ctx, { ...call, ...links })
}
