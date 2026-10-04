// @vitest-environment node
import { CALLING_TEST_SDP } from "../lib/meta/calling-fixtures"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { CallGatewayClient } from "../services/call-gateway/src/client"
import { upsertChannelThread } from "./channels/identity"
import { patchRow } from "./counts"
import { inboundFixture, fakeGraph, PHONE_ID } from "./testHelpers/meta.fixture"
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await inboundFixture()
  const organizationId = f.owner.team
  const owner = { organizationId, browserId: "owner-browser" },
    member = { organizationId, browserId: "member-browser" }
  async function online(
    client: typeof f.owner.client,
    args: typeof owner,
    extension: string
  ) {
    const agent = await client.mutation(
      internal.calling.softphoneState.begin,
      args
    )
    await client.mutation(internal.calling.softphoneState.provisioned, {
      ...args,
      leaseId: agent.leaseId,
      extension,
      expiresAt: Date.now() + 120000,
    })
    await client.mutation(api.calling.softphoneState.presence, {
      ...args,
      status: "online",
    })
    return agent
  }
  await online(f.owner.client, owner, "2000")
  await online(f.member.client, member, "2001")
  const call = await f.t.run((ctx) =>
    ctx.db.insert("calls", {
      organizationId,
      accountId: f.account,
      direction: "inbound",
      mode: "gateway",
      status: "ringing",
      observedAt: Date.now(),
      offeredAt: Date.now(),
      wacid: "wacid.claim",
    })
  )
  return { ...f, ownerArgs: owner, memberArgs: member, call, online }
}
test("two online agents race for a call: exactly one wins, the other cannot answer or control it", async () => {
  const f = await setup()
  const results = await Promise.allSettled([
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: f.call,
    }),
    f.member.client.mutation(api.calling.softphoneState.claim, {
      ...f.memberArgs,
      id: f.call,
    }),
  ])
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
  const row = await f.t.run((ctx) => ctx.db.get("calls", f.call))
  const winner =
    row!.assignedAgent === f.owner.user._id ? f.owner.client : f.member.client
  const args =
    row!.assignedAgent === f.owner.user._id ? f.ownerArgs : f.memberArgs
  const loser =
    row!.assignedAgent === f.owner.user._id ? f.member.client : f.owner.client
  const loserArgs =
    row!.assignedAgent === f.owner.user._id ? f.memberArgs : f.ownerArgs
  expect(
    await winner.mutation(api.calling.softphoneState.claim, {
      ...args,
      id: f.call,
    })
  ).toBe(f.call)
  await expect(
    loser.action(api.calling.softphone.answer, { ...loserArgs, id: f.call })
  ).rejects.toThrow("Claim this call first")
  await expect(
    loser.action(api.calling.softphone.control, {
      ...loserArgs,
      id: f.call,
      operation: "hold",
    })
  ).rejects.toThrow("Claim this call first")
})
test("away, stale, wrong team, wrong browser, API-mode and ended calls cannot be claimed", async () => {
  const f = await setup()
  await expect(
    f.outsider.client.mutation(api.calling.softphoneState.claim, {
      organizationId: f.owner.team,
      browserId: "outsider",
      id: f.call,
    })
  ).rejects.toThrow()
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      browserId: "other-tab",
      id: f.call,
    })
  ).rejects.toThrow("does not own")
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...f.ownerArgs,
    status: "away",
  })
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: f.call,
    })
  ).rejects.toThrow("Go online")
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...f.ownerArgs,
    status: "online",
  })
  await f.t.run((ctx) => ctx.db.patch("calls", f.call, { mode: "api" }))
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: f.call,
    })
  ).rejects.toThrow("no longer available")
  await f.t.run((ctx) =>
    ctx.db.patch("calls", f.call, { mode: "gateway", status: "completed" })
  )
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: f.call,
    })
  ).rejects.toThrow("no longer available")
  await f.t.run((ctx) => ctx.db.patch("calls", f.call, { status: "ringing" }))
  vi.setSystemTime(Date.now() + 76000)
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: f.call,
    })
  ).rejects.toThrow("Go online")
})
test("one agent cannot claim two active calls and another tab cannot replace a live session", async () => {
  const f = await setup()
  await expect(
    f.owner.client.mutation(internal.calling.softphoneState.begin, {
      ...f.ownerArgs,
      browserId: "other-tab",
    })
  ).rejects.toThrow("Another browser")
  await f.owner.client.mutation(api.calling.softphoneState.claim, {
    ...f.ownerArgs,
    id: f.call,
  })
  const other = await f.t.run(async (ctx) => {
    const c = await ctx.db.get("calls", f.call)
    return ctx.db.insert("calls", {
      organizationId: c!.organizationId,
      accountId: c!.accountId,
      direction: "inbound",
      mode: "gateway",
      status: "ringing",
      observedAt: Date.now(),
    })
  })
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: other,
    })
  ).rejects.toThrow("already has a call")
  await f.owner.client.mutation(api.calling.softphoneState.release, {
    ...f.ownerArgs,
    id: f.call,
  })
  expect(
    await f.member.client.mutation(api.calling.softphoneState.claim, {
      ...f.memberArgs,
      id: f.call,
    })
  ).toBe(f.call)
})
test("state is team scoped, SDP is not sent to the softphone, and revoked sessions are away", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    ctx.db.patch("calls", f.call, {
      remoteSession: { sdp_type: "offer", sdp: "private sdp" },
    })
  )
  const state = await f.owner.client.query(api.calling.softphoneState.state, {
    organizationId: f.owner.team,
  })
  expect(state.agents).toHaveLength(2)
  expect(state.calls).toHaveLength(1)
  expect(state.calls[0].remoteSession).toBeUndefined()
  const outsider = await f.outsider.client.query(
    api.calling.softphoneState.state,
    { organizationId: f.outsider.team }
  )
  expect(outsider.agents).toHaveLength(1)
  expect(outsider.agents[0].status).toBe("away")
  expect(outsider.calls).toHaveLength(0)
  await f.owner.client.mutation(
    internal.calling.softphoneState.setAway,
    f.ownerArgs
  )
  const after = await f.owner.client.query(api.calling.softphoneState.state, {
    organizationId: f.owner.team,
  })
  expect(after.agents.find((a) => a.userId === f.owner.user._id)?.status).toBe(
    "away"
  )
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.presence, {
      ...f.ownerArgs,
      status: "online",
    })
  ).rejects.toThrow("Register")
})

test("credentials are issued only to an authorized browser, refreshed per session and revoked on away", async () => {
  const f = await setup()
  vi.stubEnv("CALL_AGENT_WSS_URL", "wss://calling.example.test:7443")
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "g".repeat(64))
  const issue = vi
    .spyOn(CallGatewayClient.prototype, "agentSession")
    .mockResolvedValue({
      extension: "2000",
      password: "session-only-credential",
      expiresAt: Date.now() + 120000,
    })
  const revoke = vi
    .spyOn(CallGatewayClient.prototype, "revokeAgent")
    .mockResolvedValue()
  await expect(
    f.outsider.client.action(api.calling.softphone.session, f.ownerArgs)
  ).rejects.toThrow()
  expect(issue).not.toHaveBeenCalled()
  const first = await f.owner.client.action(
    api.calling.softphone.session,
    f.ownerArgs
  )
  const next = await f.owner.client.action(
    api.calling.softphone.session,
    f.ownerArgs
  )
  expect(first.leaseId).toBe(next.leaseId)
  expect(first.password).toBe("session-only-credential")
  const stored = await f.t.run((ctx) => ctx.db.query("callAgents").collect())
  expect(JSON.stringify(stored)).not.toContain("session-only-credential")
  await f.owner.client.action(api.calling.softphone.revoke, f.ownerArgs)
  expect(revoke).toHaveBeenCalledWith(first.leaseId)
  expect(
    (
      await f.owner.client.query(api.calling.softphoneState.state, {
        organizationId: f.owner.team,
      })
    ).agents.find((a) => a.userId === f.owner.user._id)?.status
  ).toBe("away")
})
test("outbound permission denial prevents gateway setup and creating a call", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "denied" },
        actions: [
          { action_name: "start_call", can_perform_action: false },
          {
            action_name: "send_call_permission_request",
            can_perform_action: true,
          },
        ],
      }),
    },
  ])
  const setupMedia = vi.spyOn(CallGatewayClient.prototype, "outbound")
  await expect(
    f.owner.client.action(api.calling.softphone.outbound, {
      ...f.ownerArgs,
      accountId: f.account,
      recipient: "US.13491208655302741918",
    })
  ).rejects.toThrow("Calling permission is required")
  expect(setupMedia).not.toHaveBeenCalled()
  expect(await f.t.run((ctx) => ctx.db.query("calls").collect())).toHaveLength(
    1
  )
  expect(graph.calls).toHaveLength(1)
})
test("permission requests reuse the message pipeline and preserve the BSUID identity", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "no_permission" },
        actions: [
          {
            action_name: "send_call_permission_request",
            can_perform_action: true,
          },
        ],
      }),
    },
  ])
  await expect(
    f.owner.client.action(api.calling.softphone.requestPermission, {
      organizationId: f.owner.team,
      accountId: f.account,
      recipient: "US.13491208655302741918",
    })
  ).rejects.toMatchObject({
    data: { message: expect.stringContaining("24-hour") },
  })
  await f.t.run(async (ctx) => {
    const account = await ctx.db.get("channelAccounts", f.account)
    await upsertChannelThread(ctx, account!, {
      externalId: "US.13491208655302741918",
      userId: "US.13491208655302741918",
      at: Date.now(),
      direction: "inbound",
      preview: "Voice call",
      opensWindow: true,
    })
  })
  const id = await f.owner.client.action(
    api.calling.softphone.requestPermission,
    {
      organizationId: f.owner.team,
      accountId: f.account,
      recipient: "US.13491208655302741918",
    }
  )
  const stored = await f.t.run((ctx) => ctx.db.get("channelMessages", id))
  expect(stored?.organizationId).toBe(f.owner.team)
  expect(stored?.type).toBe("interactive")
  const contact = await f.t.run((ctx) =>
    ctx.db.get("channelContacts", stored!.channelContactId!)
  )
  expect(contact?.userId).toBe("US.13491208655302741918")
})
test("transfer target reservation prevents concurrent calls from choosing the same agent", async () => {
  const f = await setup()
  await f.owner.client.mutation(api.calling.softphoneState.claim, {
    ...f.ownerArgs,
    id: f.call,
  })
  await f.t.run((ctx) => ctx.db.patch("calls", f.call, { status: "connected" }))
  const state = await f.owner.client.query(api.calling.softphoneState.state, {
    organizationId: f.owner.team,
  })
  const target = state.agents.find((a) => a.userId === f.member.user._id)!.id!
  await f.owner.client.mutation(
    internal.calling.softphoneState.transferTarget,
    { ...f.ownerArgs, id: f.call, agentId: target }
  )
  const other = await f.t.run((ctx) =>
    ctx.db.insert("calls", {
      organizationId: f.owner.team,
      accountId: f.account,
      direction: "inbound",
      mode: "gateway",
      status: "ringing",
      observedAt: Date.now(),
    })
  )
  await expect(
    f.member.client.mutation(api.calling.softphoneState.claim, {
      ...f.memberArgs,
      id: other,
    })
  ).rejects.toThrow("pending transfer")
  await f.owner.client.mutation(
    internal.calling.softphoneState.releaseTransfer,
    { ...f.ownerArgs, id: f.call, targetId: target }
  )
  expect(
    await f.member.client.mutation(api.calling.softphoneState.claim, {
      ...f.memberArgs,
      id: other,
    })
  ).toBe(other)
})

test("answer signals Graph before routing to the winning browser extension, then hangup tears down the gateway", async () => {
  const f = await setup()
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "g".repeat(64))
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const order: string[] = []
  fakeGraph([
    {
      path: `/${PHONE_ID}/calls`,
      respond: (c) => {
        order.push(`graph:${(c.body as { action: string }).action}`)
        return { success: true }
      },
    },
  ])
  const route = vi
    .spyOn(CallGatewayClient.prototype, "route")
    .mockImplementation(async () => {
      order.push("route:agent")
    })
  const cleanup = vi
    .spyOn(CallGatewayClient.prototype, "hangup")
    .mockResolvedValue()
  await f.t.run((ctx) =>
    ctx.db.patch("calls", f.call, {
      localSession: { sdp_type: "answer", sdp: CALLING_TEST_SDP },
    })
  )
  await f.owner.client.mutation(api.calling.softphoneState.claim, {
    ...f.ownerArgs,
    id: f.call,
  })
  await f.owner.client.action(api.calling.softphone.answer, {
    ...f.ownerArgs,
    id: f.call,
  })
  expect(order).toEqual(["graph:accept", "route:agent"])
  const answered = await f.t.run((ctx) => ctx.db.get("calls", f.call))
  expect(route).toHaveBeenCalledWith({
    callId: f.call,
    target: "agent",
    extension: "2000",
    answeredAt: answered?.connectedAt,
  })
  expect(answered?.status).toBe("connected")
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...f.ownerArgs,
    status: "away",
  })
  await f.owner.client.action(api.calling.softphone.hangup, {
    ...f.ownerArgs,
    id: f.call,
  })
  expect(cleanup).toHaveBeenCalledWith(f.call)
  expect((await f.t.run((ctx) => ctx.db.get("calls", f.call)))?.status).toBe(
    "completed"
  )
})
test("outbound reserves one call per agent atomically and routes its remote answer to that browser", async () => {
  const f = await setup()
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "g".repeat(64))
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "permanent" },
        actions: [{ action_name: "start_call", can_perform_action: true }],
      }),
    },
    {
      path: `/${PHONE_ID}/calls`,
      respond: () => ({ calls: [{ id: "wacid.browser-outbound" }] }),
    },
  ])
  const media = vi
    .spyOn(CallGatewayClient.prototype, "outbound")
    .mockResolvedValue({ offerSdp: CALLING_TEST_SDP })
  vi.spyOn(CallGatewayClient.prototype, "remoteAnswer").mockResolvedValue()
  const route = vi
    .spyOn(CallGatewayClient.prototype, "route")
    .mockResolvedValue()
  const args = {
    ...f.ownerArgs,
    accountId: f.account,
    recipient: "US.13491208655302741918",
  }
  const race = await Promise.allSettled([
    f.owner.client.action(api.calling.softphone.outbound, args),
    f.owner.client.action(api.calling.softphone.outbound, args),
  ])
  expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  expect(media).toHaveBeenCalledTimes(1)
  const result = race.find((r) => r.status === "fulfilled")!
  if (result.status !== "fulfilled") throw new Error("Missing call")
  const row = await f.t.run((ctx) => ctx.db.get("calls", result.value))
  expect(row).toMatchObject({
    assignedAgent: f.owner.user._id,
    agentExtension: "2000",
    mode: "gateway",
  })
  await f.t.run((ctx) =>
    ctx.db.patch("calls", result.value, {
      remoteSession: { sdp_type: "answer", sdp: CALLING_TEST_SDP },
    })
  )
  await f.t.action(internal.calling.callActions.gatewayConnect, {
    id: result.value,
  })
  expect(route).toHaveBeenCalledWith({
    callId: result.value,
    target: "agent",
    extension: "2000",
  })
})

test("presence switches Away and Online, and only the owning tab can toggle it", async () => {
  const f = await setup()
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...f.ownerArgs,
    status: "away",
  })
  const read = () =>
    f.owner.client.query(api.calling.softphoneState.state, {
      organizationId: f.owner.team,
    })
  expect((await read()).me?.status).toBe("away")
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.presence, {
      ...f.ownerArgs,
      browserId: "other-tab",
      status: "online",
    })
  ).rejects.toThrow("does not own")
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...f.ownerArgs,
    status: "online",
  })
  expect((await read()).me?.status).toBe("online")
})

test("disconnect rejects stale leases and makes the last owning tab unavailable", async () => {
  const f = await setup()
  const row = await f.t.run((ctx) =>
    ctx.db
      .query("callAgents")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", f.owner.team).eq("userId", f.owner.user._id)
      )
      .unique()
  )
  const args = {
    id: row!._id,
    browserId: row!.browserId,
    leaseId: row!.leaseId,
  }
  await f.t.mutation(internal.calling.softphoneState.disconnect, {
    ...args,
    leaseId: "stale",
  })
  await f.t.mutation(internal.calling.softphoneState.disconnect, {
    ...args,
    browserId: "other-tab",
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", args.id)))?.status
  ).toBe("online")
  await f.t.mutation(internal.calling.softphoneState.disconnect, args)
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", args.id)))?.status
  ).toBe("away")
  await expect(
    f.owner.client.mutation(api.calling.softphoneState.claim, {
      ...f.ownerArgs,
      id: f.call,
    })
  ).rejects.toThrow("Go online")
  // A fresh tab can immediately take over; the old tab's beacon cannot revoke it.
  const next = await f.owner.client.mutation(
    internal.calling.softphoneState.begin,
    { ...f.ownerArgs, browserId: "next-tab" }
  )
  await f.t.mutation(internal.calling.softphoneState.disconnect, args)
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", next._id)))?.leaseId
  ).toBe(next.leaseId)
})

test("heartbeat expiry materializes Away; an earlier timer cannot expire a renewed lease", async () => {
  const f = await setup()
  const row = await f.t.run((ctx) =>
    ctx.db
      .query("callAgents")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", f.owner.team).eq("userId", f.owner.user._id)
      )
      .unique()
  )
  const args = {
    id: row!._id,
    leaseId: row!.leaseId,
    updatedAt: row!.updatedAt,
  }
  vi.setSystemTime(Date.now() + 30000)
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...f.ownerArgs,
    status: "online",
  })
  vi.setSystemTime(Date.now() + 45000)
  await f.t.mutation(internal.calling.softphoneState.expire, args)
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", args.id)))?.status
  ).toBe("online")
  vi.setSystemTime(Date.now() + 30000)
  await f.t.mutation(internal.calling.softphoneState.expire, {
    ...args,
    updatedAt: args.updatedAt + 30000,
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", args.id)))?.status
  ).toBe("away")
})

test("refreshing credentials cannot cancel the last presence expiry", async () => {
  const f = await setup()
  const row = await f.t.run((ctx) =>
    ctx.db
      .query("callAgents")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", f.owner.team).eq("userId", f.owner.user._id)
      )
      .unique()
  )
  vi.setSystemTime(Date.now() + 30000)
  const refreshed = await f.owner.client.mutation(
    internal.calling.softphoneState.begin,
    f.ownerArgs
  )
  expect(refreshed.leaseId).toBe(row!.leaseId)
  vi.setSystemTime(Date.now() + 45000)
  await f.t.mutation(internal.calling.softphoneState.expire, {
    id: row!._id,
    leaseId: row!.leaseId,
    updatedAt: row!.updatedAt,
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", row!._id)))?.status
  ).toBe("away")
})

test("Decline claims the call before rejecting it through the existing call API", async () => {
  const f = await setup()
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "g".repeat(64))
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const actions: string[] = []
  fakeGraph([
    {
      path: `/${PHONE_ID}/calls`,
      respond: (request) => {
        actions.push((request.body as { action: string }).action)
        return { success: true }
      },
    },
  ])
  const cleanup = vi
    .spyOn(CallGatewayClient.prototype, "hangup")
    .mockResolvedValue()
  await f.owner.client.mutation(api.calling.softphoneState.claim, {
    ...f.ownerArgs,
    id: f.call,
  })
  await f.owner.client.action(api.calling.softphone.hangup, {
    ...f.ownerArgs,
    id: f.call,
  })
  expect(actions).toEqual(["reject", "terminate"])
  expect(cleanup).toHaveBeenCalledWith(f.call)
  expect((await f.t.run((ctx) => ctx.db.get("calls", f.call)))?.status).toBe(
    "rejected"
  )
})

test("tab-close HTTP capability validates input and can only disconnect its exact lease", async () => {
  const f = await setup()
  const row = await f.t.run((ctx) =>
    ctx.db
      .query("callAgents")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", f.owner.team).eq("userId", f.owner.user._id)
      )
      .unique()
  )
  const args = {
    id: row!._id,
    browserId: row!.browserId,
    leaseId: row!.leaseId,
  }
  const send = (body: string) =>
    f.t.fetch("/calling/softphone/leave", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    })
  expect((await send("{}")).status).toBe(400)
  expect((await send(JSON.stringify({ ...args, leaseId: "bad" }))).status).toBe(
    400
  )
  expect(
    (await send(JSON.stringify({ ...args, leaseId: crypto.randomUUID() })))
      .status
  ).toBe(204)
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", args.id)))?.status
  ).toBe("online")
  expect((await send(JSON.stringify(args))).status).toBe(204)
  expect(
    (await f.t.run((ctx) => ctx.db.get("callAgents", args.id)))?.status
  ).toBe("away")
})
