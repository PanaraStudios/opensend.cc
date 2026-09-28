import { v, ConvexError } from "convex/values"
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter"
import {
  env,
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server"
import { components } from "./_generated/api"
import { requireTeam, findInstallation, defaultCallbackOrigin } from "./access"
import {
  LIMITS,
  emitContact,
  findTopicChoice,
  setTopicChoice,
  teamRow,
  updateContact,
} from "./audience"
import { effectiveTopicSubscription } from "../lib/dashboard/contacts"
import { UNSUBSCRIBE_VARIABLE_NAME } from "../lib/dashboard/email-variables"
import {
  UNSUBSCRIBE_PAGE_DEFAULTS,
  unsubscribePageInput,
  type UnsubscribePage,
} from "../lib/unsubscribe/page"
import {
  listUnsubscribeHeaders,
  readUnsubscribeToken,
  signUnsubscribeToken,
} from "../lib/unsubscribe/token"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/* Settings → Unsubscribe, the signed per-recipient links senders put in
   every email, and the public preference page and one-click endpoint those
   links open. A recipient's changes go through the audience helpers, so
   `contact.updated` fires exactly as for a dashboard edit. */

type Ctx = QueryCtx | MutationCtx

const limiter = new RateLimiter(components.rateLimiter, {
  // Per contact: someone flipping switches stays well inside it, a script
  // replaying one link does not.
  unsubscribe: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 30 },
})

const pageValue = v.object({
  brandName: v.string(),
  heading: v.string(),
  body: v.string(),
})

const findPage = (ctx: Ctx, organizationId: string) =>
  ctx.db
    .query("unsubscribePages")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .unique()

/** The only writer of `unsubscribePages`. */
async function writePage(
  ctx: MutationCtx,
  organizationId: string,
  page: UnsubscribePage
) {
  const existing = await findPage(ctx, organizationId)
  const row = { ...page, updatedAt: Date.now() }
  if (existing) await ctx.db.patch("unsubscribePages", existing._id, row)
  else await ctx.db.insert("unsubscribePages", { organizationId, ...row })
}

/** The saved page, or the defaults under the team's current name. */
async function teamPage(
  ctx: Ctx,
  organizationId: string
): Promise<UnsubscribePage> {
  const saved = await findPage(ctx, organizationId)
  if (saved)
    return {
      brandName: saved.brandName,
      heading: saved.heading,
      body: saved.body,
    }
  const team: { name?: unknown } | null = await ctx.runQuery(
    components.betterAuth.adapter.findOne,
    {
      model: "organization",
      where: [{ field: "_id", value: organizationId }],
    }
  )
  return {
    ...UNSUBSCRIBE_PAGE_DEFAULTS,
    brandName: typeof team?.name === "string" ? team.name : "",
  }
}

export const page = query({
  args: { organizationId: v.string() },
  returns: pageValue,
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    return teamPage(ctx, organizationId)
  },
})

export const savePage = mutation({
  args: { organizationId: v.string(), ...pageValue.fields },
  returns: v.null(),
  handler: async (ctx, { organizationId, ...input }) => {
    await requireTeam(ctx, organizationId, "write")
    const result = unsubscribePageInput(input)
    if ("error" in result) throw new ConvexError(result.error)
    await writePage(ctx, organizationId, result.page)
    return null
  },
})

function secret() {
  return env.BETTER_AUTH_SECRET ?? ""
}

/** One recipient's unsubscribe links, for every sender (sends, broadcasts,
    automations). `pageUrl` fills {{{OPENSEND_UNSUBSCRIBE_URL}}}; `headers`
    go on the message so mailbox providers offer one-click unsubscribe. With
    `topicId`, one-click leaves only that topic. */
export async function unsubscribeLinks(
  ctx: Ctx,
  target: {
    organizationId: string
    contactId: Id<"contacts">
    topicId?: Id<"topics">
  }
) {
  await teamRow(ctx, "contacts", target.organizationId, target.contactId)
  if (target.topicId)
    await teamRow(ctx, "topics", target.organizationId, target.topicId)
  const token = await signUnsubscribeToken(target, secret())
  // The one-click POST comes from mailbox providers, so it goes to the
  // public HTTPS origin AWS already reaches.
  const origin =
    (await findInstallation(ctx))?.callbackOrigin || defaultCallbackOrigin()
  const pageUrl = `${env.SITE_URL}/unsubscribe/${token}`
  const oneClickUrl = `${origin}/unsubscribe/${token}`
  return {
    pageUrl,
    oneClickUrl,
    headers: listUnsubscribeHeaders(oneClickUrl),
    variables: { [UNSUBSCRIBE_VARIABLE_NAME]: pageUrl },
  }
}

const linksValue = v.object({
  pageUrl: v.string(),
  oneClickUrl: v.string(),
  headers: v.object({
    "List-Unsubscribe": v.string(),
    "List-Unsubscribe-Post": v.string(),
  }),
  variables: v.record(v.string(), v.string()),
})
/** `unsubscribeLinks` for senders running in actions. */
export const links = internalQuery({
  args: {
    organizationId: v.string(),
    contactId: v.id("contacts"),
    topicId: v.optional(v.id("topics")),
  },
  returns: linksValue,
  handler: (ctx, args) => unsubscribeLinks(ctx, args),
})

/** The contact a link is for; null for a link this server did not sign, or
    whose contact is gone. */
async function recipient(ctx: Ctx, token: string) {
  const target = await readUnsubscribeToken(token, secret())
  if (!target) return null
  const contactId = ctx.db.normalizeId("contacts", target.contactId)
  const contact = contactId && (await ctx.db.get("contacts", contactId))
  if (!contact || contact.organizationId !== target.organizationId) return null
  const topicId = target.topicId
    ? ctx.db.normalizeId("topics", target.topicId)
    : null
  return { contact, topicId }
}

async function publicTopics(ctx: Ctx, organizationId: string) {
  const topics = await ctx.db
    .query("topics")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .order("desc")
    .take(LIMITS.topics)
  return topics.filter((topic) => topic.visibility === "public")
}

/** The page a recipient's link opens: the team's page and the contact's
    standing with each public topic. Private topics and the address itself
    are never shown. */
export const preferences = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      page: pageValue,
      unsubscribed: v.boolean(),
      topics: v.array(
        v.object({
          id: v.id("topics"),
          name: v.string(),
          subscribed: v.boolean(),
        })
      ),
    })
  ),
  handler: async (ctx, { token }) => {
    const found = await recipient(ctx, token)
    if (!found) return null
    const { contact } = found
    const topics = []
    for (const topic of await publicTopics(ctx, contact.organizationId)) {
      const choice = await findTopicChoice(ctx, contact._id, topic._id)
      topics.push({
        id: topic._id,
        name: topic.name,
        subscribed:
          effectiveTopicSubscription(choice?.subscription, topic) ===
          "subscribed",
      })
    }
    return {
      page: await teamPage(ctx, contact.organizationId),
      unsubscribed: contact.unsubscribed,
      topics,
    }
  },
})

async function limited(ctx: MutationCtx, contact: Doc<"contacts">) {
  return !(await limiter.limit(ctx, "unsubscribe", { key: contact._id })).ok
}
async function writableRecipient(ctx: MutationCtx, token: string) {
  const found = await recipient(ctx, token)
  if (!found) throw new ConvexError("Contact not found")
  if (await limited(ctx, found.contact))
    throw new ConvexError("Too many changes. Try again in a minute.")
  return found
}

async function chooseTopic(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  topicId: Id<"topics">,
  subscribed: boolean
) {
  if (
    await setTopicChoice(
      ctx,
      contact,
      topicId,
      subscribed ? "subscribed" : "unsubscribed"
    )
  )
    await emitContact(ctx, "contact.updated", contact)
}

/** A recipient's switch for one public topic. */
export const setTopic = mutation({
  args: { token: v.string(), topicId: v.string(), subscribed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { contact } = await writableRecipient(ctx, args.token)
    const topicId = ctx.db.normalizeId("topics", args.topicId)
    const topic = topicId && (await ctx.db.get("topics", topicId))
    if (
      !topic ||
      topic.organizationId !== contact.organizationId ||
      topic.visibility !== "public"
    )
      throw new ConvexError("Topic not found")
    await chooseTopic(ctx, contact, topic._id, args.subscribed)
    return null
  },
})

/** Unsubscribes from everything the team sends, or back again. */
export const setSubscribed = mutation({
  args: { token: v.string(), subscribed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { contact } = await writableRecipient(ctx, args.token)
    await updateContact(ctx, contact, { unsubscribed: !args.subscribed })
    return null
  },
})

/** RFC 8058 one-click: leaves the link's topic, or everything when the link
    has none. Repeating it changes nothing. */
export const oneClick = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.literal("done"),
    v.literal("invalid"),
    v.literal("limited")
  ),
  handler: async (ctx, { token }) => {
    const found = await recipient(ctx, token)
    if (!found) return "invalid"
    const { contact, topicId } = found
    if (await limited(ctx, contact)) return "limited"
    if (!topicId) {
      await updateContact(ctx, contact, { unsubscribed: true })
      return "done"
    }
    // A topic deleted since the send has no more mail to leave.
    const topic = await ctx.db.get("topics", topicId)
    if (topic && topic.organizationId === contact.organizationId)
      await chooseTopic(ctx, contact, topicId, false)
    return "done"
  },
})
