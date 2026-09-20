import { v, ConvexError } from "convex/values"
import { mutation, query, action } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { api } from "./_generated/api"
import { requireMember, sessionUser } from "./policy"
import { invalidate } from "./oauth"
const role = v.union(v.literal("admin"), v.literal("member"))
const teamValue = v.object({
  id: v.string(),
  name: v.string(),
  slug: v.string(),
  role,
  joinedAt: v.number(),
  members: v.number(),
  avatar: v.optional(v.string()),
  ssoRequired: v.boolean(),
  ssoConfigured: v.boolean(),
})
const memberValue = v.object({
  id: v.string(),
  name: v.string(),
  email: v.string(),
  role,
  status: v.union(v.literal("active"), v.literal("invited")),
  joinedAt: v.number(),
  you: v.boolean(),
  mfa: v.boolean(),
})
export const snapshotValue = v.object({
  user: v.object({
    id: v.string(),
    email: v.string(),
    name: v.string(),
    mfa: v.boolean(),
    createdAt: v.number(),
  }),
  teams: v.array(teamValue),
  activeTeamId: v.union(v.string(), v.null()),
  members: v.array(memberValue),
  invitations: v.array(
    v.object({
      id: v.string(),
      email: v.string(),
      role,
      expiresAt: v.number(),
      status: v.string(),
    })
  ),
  receivedInvitations: v.array(
    v.object({ id: v.string(), name: v.string(), expiresAt: v.number() })
  ),
  sso: v.union(
    v.null(),
    v.object({
      issuer: v.string(),
      clientId: v.string(),
      tested: v.boolean(),
      enforced: v.boolean(),
    })
  ),
})
export const snapshot = query({
  args: { sessionId: v.string() },
  returns: snapshotValue,
  handler: async (ctx, { sessionId }) => {
    const { user, session } = await sessionUser(ctx, sessionId)
    const memberships = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .take(50)
    const teams = []
    for (const membership of memberships) {
      const org = await ctx.db.get(
        "organization",
        membership.organizationId as Id<"organization">
      )
      if (!org) continue
      const members = await ctx.db
        .query("member")
        .withIndex("organizationId", (q) => q.eq("organizationId", org._id))
        .take(100)
      const avatar = await ctx.db
        .query("avatar")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", org._id))
        .unique()
      const sso = await ctx.db
        .query("sso")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", org._id))
        .unique()
      const proof = await ctx.db
        .query("ssoProof")
        .withIndex("by_sessionId_and_organizationId", (q) =>
          q.eq("sessionId", sessionId).eq("organizationId", org._id)
        )
        .unique()
      teams.push({
        id: org._id,
        name: org.name,
        slug: org.slug,
        role:
          membership.role === "owner"
            ? ("admin" as const)
            : ("member" as const),
        joinedAt: membership.createdAt,
        members: members.length,
        avatar: avatar
          ? ((await ctx.storage.getUrl(avatar.storageId)) ?? undefined)
          : undefined,
        ssoRequired: !!sso?.enforced && proof?.revision !== sso.revision,
        ssoConfigured: !!sso,
      })
    }
    const active =
      teams.find((t) => t.id === session.activeOrganizationId) ?? teams[0]
    const members = []
    const invitations = []
    let sso = null
    if (active && !active.ssoRequired) {
      await requireMember(ctx, sessionId, active.id)
      for (const m of await ctx.db
        .query("member")
        .withIndex("organizationId", (q) => q.eq("organizationId", active.id))
        .take(100)) {
        const person = await ctx.db.get("user", m.userId as Id<"user">)
        if (person)
          members.push({
            id: m._id,
            name: person.name,
            email: person.email,
            role: m.role === "owner" ? ("admin" as const) : ("member" as const),
            status: "active" as const,
            joinedAt: m.createdAt,
            you: person._id === user._id,
            mfa: !!person.twoFactorEnabled,
          })
      }
      if (active.role === "admin") {
        for (const i of await ctx.db
          .query("invitation")
          .withIndex("organizationId", (q) => q.eq("organizationId", active.id))
          .take(100)) {
          if (i.status === "pending")
            invitations.push({
              id: i._id,
              email: i.email,
              role:
                i.role === "owner" ? ("admin" as const) : ("member" as const),
              expiresAt: i.expiresAt,
              status: i.expiresAt <= Date.now() ? "expired" : i.status,
            })
        }
        const c = await ctx.db
          .query("sso")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", active.id)
          )
          .unique()
        if (c)
          sso = {
            issuer: c.issuer,
            clientId: c.clientId,
            tested: c.tested,
            enforced: c.enforced,
          }
      }
    }
    const receivedInvitations = []
    for (const i of await ctx.db
      .query("invitation")
      .withIndex("email", (q) => q.eq("email", user.email))
      .take(100)) {
      if (i.status !== "pending" || i.expiresAt <= Date.now()) continue
      const org = await ctx.db.get(
        "organization",
        i.organizationId as Id<"organization">
      )
      if (org)
        receivedInvitations.push({
          id: i._id,
          name: org.name,
          expiresAt: i.expiresAt,
        })
    }
    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        mfa: !!user.twoFactorEnabled,
        createdAt: user.createdAt,
      },
      teams,
      activeTeamId: active?.id ?? null,
      members,
      invitations,
      receivedInvitations,
      sso,
    }
  },
})
function cleanName(name: string) {
  const value = name.trim()
  if (!value || value.length > 100)
    throw new ConvexError("Use a team name between 1 and 100 characters")
  return value
}
export const create = mutation({
  args: { sessionId: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { user, session } = await sessionUser(ctx, args.sessionId)
    const memberships = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .take(50)
    if (memberships.length >= 50) throw new ConvexError("Team limit reached")
    const name = cleanName(args.name)
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "team"
    let slug = base
    let n = 1
    while (
      await ctx.db
        .query("organization")
        .withIndex("slug", (q) => q.eq("slug", slug))
        .unique()
    )
      slug = `${base}-${++n}`
    const id = await ctx.db.insert("organization", {
      name,
      slug,
      createdAt: Date.now(),
    })
    await ctx.db.insert("member", {
      organizationId: id,
      userId: user._id,
      role: "owner",
      createdAt: Date.now(),
    })
    await ctx.db.patch("session", session._id, { activeOrganizationId: id })
    return id
  },
})
export const switchTeam = mutation({
  args: { sessionId: v.string(), organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, session } = await sessionUser(ctx, args.sessionId)
    const member = await ctx.db
      .query("member")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", user._id)
      )
      .unique()
    if (!member) throw new ConvexError("You do not belong to this team")
    await ctx.db.patch("session", session._id, {
      activeOrganizationId: args.organizationId,
    })
    return null
  },
})
export const rename = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.sessionId, args.organizationId, true)
    if (args.slug !== undefined) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug) ||
        args.slug.length > 100
      )
        throw new ConvexError("Use a valid team slug")
      const existing = await ctx.db
        .query("organization")
        .withIndex("slug", (q) => q.eq("slug", args.slug!))
        .unique()
      if (existing && existing._id !== args.organizationId)
        throw new ConvexError("That slug is already in use")
    }
    await ctx.db.patch(
      "organization",
      args.organizationId as Id<"organization">,
      {
        name: cleanName(args.name),
        ...(args.slug !== undefined ? { slug: args.slug } : {}),
      }
    )
    return null
  },
})
async function protectOwner(
  ctx: MutationCtx,
  organizationId: string,
  memberId: string
) {
  const members = await ctx.db
    .query("member")
    .withIndex("organizationId", (q) => q.eq("organizationId", organizationId))
    .take(100)
  if (!members.some((m) => m._id !== memberId && m.role === "owner"))
    throw new ConvexError(
      "Promote another admin before leaving or removing the last admin"
    )
}
export const changeMember = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    memberId: v.string(),
    role: v.optional(role),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.sessionId, args.organizationId, true)
    const target = await ctx.db.get("member", args.memberId as Id<"member">)
    if (!target || target.organizationId !== args.organizationId)
      throw new ConvexError("Member not found")
    if (target.role === "owner" && args.role !== "admin")
      await protectOwner(ctx, args.organizationId, target._id)
    if (args.role)
      await ctx.db.patch("member", target._id, {
        role: args.role === "admin" ? "owner" : "member",
      })
    else await ctx.db.delete("member", target._id)
    if (args.role !== "admin") await invalidate(ctx, `member:${target._id}`)
    return null
  },
})
async function deleteOrganization(ctx: MutationCtx, organizationId: string) {
  for (const m of await ctx.db
    .query("member")
    .withIndex("organizationId", (q) => q.eq("organizationId", organizationId))
    .take(100))
    await ctx.db.delete("member", m._id)
  for (const i of await ctx.db
    .query("invitation")
    .withIndex("organizationId", (q) => q.eq("organizationId", organizationId))
    .take(100))
    await ctx.db.delete("invitation", i._id)
  const sso = await ctx.db
    .query("sso")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .unique()
  if (sso) await ctx.db.delete("sso", sso._id)
  const avatar = await ctx.db
    .query("avatar")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .unique()
  if (avatar) {
    await ctx.storage.delete(avatar.storageId)
    await ctx.db.delete("avatar", avatar._id)
  }
  await ctx.db.delete("organization", organizationId as Id<"organization">)
}
export const remove = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    leave: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireMember(
      ctx,
      args.sessionId,
      args.organizationId,
      !args.leave
    )
    const members = await ctx.db
      .query("member")
      .withIndex("organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .take(2)
    if (!args.leave || members.length === 1)
      await deleteOrganization(ctx, args.organizationId)
    else {
      if (member.role === "owner")
        await protectOwner(ctx, args.organizationId, member._id)
      await ctx.db.delete("member", member._id)
    }
    return null
  },
})
export const invite = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    email: v.string(),
    role,
  },
  returns: v.object({ id: v.string(), email: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(
      ctx,
      args.sessionId,
      args.organizationId,
      true
    )
    const email = args.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ConvexError("Enter a valid email")
    const existing = await ctx.db
      .query("invitation")
      .withIndex("organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .take(100)
    const old = existing.find(
      (i) => i.email === email && i.status === "pending"
    )
    const data = {
      organizationId: args.organizationId,
      email,
      role: args.role === "admin" ? "owner" : "member",
      status: "pending",
      expiresAt: Date.now() + 7 * 86400000,
      createdAt: Date.now(),
      inviterId: user._id,
    }
    if (old) {
      await ctx.db.patch("invitation", old._id, data)
      return { id: old._id, email }
    }
    if (existing.length >= 100)
      throw new ConvexError("Cancel old invitations before adding more")
    return { id: await ctx.db.insert("invitation", data), email }
  },
})
export const cancelInvitation = mutation({
  args: { sessionId: v.string(), invitationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const i = await ctx.db.get(
      "invitation",
      args.invitationId as Id<"invitation">
    )
    if (!i) throw new ConvexError("Invitation not found")
    await requireMember(ctx, args.sessionId, i.organizationId, true)
    await ctx.db.delete("invitation", i._id)
    return null
  },
})
export const respond = mutation({
  args: {
    sessionId: v.string(),
    invitationId: v.string(),
    accept: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, session } = await sessionUser(ctx, args.sessionId)
    const i = await ctx.db.get(
      "invitation",
      args.invitationId as Id<"invitation">
    )
    if (
      !i ||
      i.email !== user.email ||
      i.status !== "pending" ||
      i.expiresAt <= Date.now()
    )
      throw new ConvexError("This invitation is not valid for your account")
    if (args.accept) {
      const memberships = await ctx.db
        .query("member")
        .withIndex("userId", (q) => q.eq("userId", user._id))
        .take(50)
      const members = await ctx.db
        .query("member")
        .withIndex("organizationId", (q) =>
          q.eq("organizationId", i.organizationId)
        )
        .take(100)
      if (memberships.length >= 50 || members.length >= 100)
        throw new ConvexError("Team membership limit reached")
      if (!members.some((m) => m.userId === user._id))
        await ctx.db.insert("member", {
          organizationId: i.organizationId,
          userId: user._id,
          role: i.role === "owner" ? "owner" : "member",
          createdAt: Date.now(),
        })
      await ctx.db.patch("session", session._id, {
        activeOrganizationId: i.organizationId,
      })
    }
    await ctx.db.delete("invitation", i._id)
    return null
  },
})
export const deleteAccount = mutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, session } = await sessionUser(ctx, args.sessionId)
    if (Date.now() - session.createdAt > 300000)
      throw new ConvexError("Sign in again before deleting your account")
    const memberships = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .take(50)
    for (const member of memberships) {
      await requireMember(ctx, args.sessionId, member.organizationId)
      const members = await ctx.db
        .query("member")
        .withIndex("organizationId", (q) =>
          q.eq("organizationId", member.organizationId)
        )
        .take(2)
      if (members.length === 1)
        await deleteOrganization(ctx, member.organizationId)
      else {
        if (member.role === "owner")
          await protectOwner(ctx, member.organizationId, member._id)
        await ctx.db.delete("member", member._id)
      }
    }
    for (const table of ["session", "account", "twoFactor"] as const) {
      for await (const row of ctx.db
        .query(table)
        .withIndex("userId", (q) => q.eq("userId", user._id)))
        await ctx.db.delete(table, row._id)
    }
    await ctx.db.delete("user", user._id)
    return null
  },
})
export const checkOwner = query({
  args: { sessionId: v.string(), organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.sessionId, args.organizationId, true)
    return null
  },
})
export const uploadAvatar = action({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    bytes: v.bytes(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runQuery(api.teams.checkOwner, {
      sessionId: args.sessionId,
      organizationId: args.organizationId,
    })
    if (
      args.bytes.byteLength > 1048576 ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        args.contentType
      )
    )
      throw new ConvexError("Upload an image up to 1 MB")
    const storageId = await ctx.storage.store(
      new Blob([args.bytes], { type: args.contentType })
    )
    try {
      await ctx.runMutation(api.teams.setAvatar, {
        sessionId: args.sessionId,
        organizationId: args.organizationId,
        storageId,
      })
    } catch (error) {
      await ctx.storage.delete(storageId)
      throw error
    }
    return null
  },
})
export const setAvatar = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.sessionId, args.organizationId, true)
    if (args.storageId) {
      const metadata = await ctx.db.system.get("_storage", args.storageId)
      if (
        !metadata ||
        metadata.size > 1048576 ||
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          metadata.contentType ?? ""
        )
      )
        throw new ConvexError("Upload a PNG, JPEG, WebP or GIF up to 1 MB")
      // A storage object cannot be assigned to multiple teams.
      const used = await ctx.db
        .query("avatar")
        .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId!))
        .unique()
      if (used && used.organizationId !== args.organizationId)
        throw new ConvexError("Image already in use")
    }
    const old = await ctx.db
      .query("avatar")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .unique()
    if (old) {
      if (old.storageId !== args.storageId)
        await ctx.storage.delete(old.storageId)
      await ctx.db.delete("avatar", old._id)
    }
    if (args.storageId)
      await ctx.db.insert("avatar", {
        organizationId: args.organizationId,
        storageId: args.storageId,
      })
    return null
  },
})
