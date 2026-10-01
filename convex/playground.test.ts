// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
async function setup() {
  const f = await inboundFixture(),
    args = { organizationId: f.owner.team, browserId: "playground" }
  const agent = await f.owner.client.mutation(
    internal.calling.softphoneState.begin,
    args
  )
  await f.owner.client.mutation(internal.calling.softphoneState.provisioned, {
    ...args,
    leaseId: agent.leaseId,
    extension: "2000",
    expiresAt: Date.now() + 120000,
  })
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...args,
    status: "online",
  })
  const ivrId = await f.t.run((ctx) =>
    ctx.db.insert("ivrs", {
      organizationId: args.organizationId,
      name: "Reception",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt: { kind: "tts", text: "Hello" },
          options: {},
          noInputAction: { kind: "hangup" },
          failureAction: { kind: "hangup" },
          timeoutSeconds: 5,
          retries: 2,
          maxDigits: 1,
        },
      ],
      webhookSecret: "unused",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  return {
    ...f,
    args,
    ivrId,
    createArgs: { ...args, accountId: f.account, ivrId },
  }
}
test("playground calls reserve the browser, are marked test and are isolated", async () => {
  const f = await setup()
  const call = await f.owner.client.mutation(
    internal.calling.playgroundState.create,
    f.createArgs
  )
  expect(call.test).toBe(true)
  expect(call.wacid).toBeUndefined()
  expect(call.agentExtension).toBe("2000")
  await expect(
    f.owner.client.mutation(
      internal.calling.playgroundState.create,
      f.createArgs
    )
  ).rejects.toMatchObject({ data: "Agent already has a call" })
  await expect(
    f.outsider.client.query(api.calling.playgroundState.detail, {
      organizationId: f.outsider.team,
      id: call._id,
    })
  ).rejects.toBeDefined()
  await expect(
    f.owner.client.query(internal.calling.playgroundState.owned, {
      ...f.args,
      browserId: "other",
      id: call._id,
    })
  ).rejects.toBeDefined()
  await f.owner.client.mutation(internal.calling.rows.finish, {
    id: call._id,
    status: "completed",
  })
  const detail = await f.owner.client.query(
    api.calling.playgroundState.detail,
    { organizationId: f.owner.team, id: call._id }
  )
  expect(detail.test).toBe(true)
  expect(detail.status).toBe("completed")
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(events.some((e) => e.type.startsWith("whatsapp.call."))).toBe(false)
})
test("playground refuses an IVR and account from another team before external IO", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    ctx.db.patch("ivrs", f.ivrId, { organizationId: f.outsider.team })
  )
  await expect(
    f.owner.client.mutation(
      internal.calling.playgroundState.create,
      f.createArgs
    )
  ).rejects.toBeDefined()
  expect(await f.t.run((ctx) => ctx.db.query("calls").collect())).toHaveLength(
    0
  )
})
