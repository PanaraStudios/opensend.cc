// @vitest-environment node
import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
import { buildIceServers, turnCredential } from "../lib/calling/turn"

beforeEach(() => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", randomBytes(32).toString("hex"))
  vi.stubEnv("CALL_TURN_SECRET", randomBytes(32).toString("hex"))
  vi.stubEnv(
    "CALL_TURN_URLS",
    "turn:relay.example.test:3478?transport=udp,turns:relay.example.test:5349?transport=tcp"
  )
  vi.stubEnv("CALL_STUN_URLS", "stun:stun.example.test:3478")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test("HMAC-SHA1 matches RFC 2202 test case 2, encoded as base64", () => {
  // Public standard test vector, never a deployment secret.
  const expected = Buffer.from([
    0xef, 0xfc, 0xdf, 0x6a, 0xe5, 0xeb, 0x2f, 0xa2, 0xd2, 0x74, 0x16, 0xd5,
    0xf1, 0x84, 0xdf, 0x9c, 0x25, 0x9a, 0x7c, 0x79,
  ]).toString("base64")
  expect(turnCredential("Jefe", "what do ya want for nothing?")).toBe(expected)
})

test("REST username embeds a one-hour Unix expiry and an opaque lease", () => {
  const now = 1700000000123
  const secret = randomBytes(32).toString("hex")
  const result = buildIceServers({
    now,
    secret,
    leaseId: "opaque-session",
    turnUrls: "turn:relay.example.test:3478",
  })
  expect(result.expiresAt).toBe(1700003600000)
  expect(result.expiresAt! - now).toBeGreaterThan(3599000)
  const turn = result.iceServers[1]
  expect(turn.username).toBe("1700003600:opaque-session")
  expect(turn.credential).toBe(turnCredential(secret, turn.username!))
  expect(Buffer.from(turn.credential!, "base64")).toHaveLength(20)
  expect(JSON.stringify(result).includes(secret)).toBe(false)
})

async function setup() {
  const f = await inboundFixture()
  const args = { organizationId: f.owner.team, browserId: "owner-browser" }
  const row = await f.owner.client.mutation(
    internal.calling.softphoneState.begin,
    args
  )
  await f.owner.client.mutation(internal.calling.softphoneState.provisioned, {
    ...args,
    leaseId: row.leaseId,
    extension: "2000",
    expiresAt: Date.now() + 120000,
  })
  return { ...f, args, row }
}

test("authenticated agent gets configured STUN and TURN, never shared secret or identity", async () => {
  const f = await setup()
  const before = Math.floor(Date.now() / 1000)
  const result = await f.owner.client.action(
    api.calling.softphone.iceServers,
    f.args
  )
  expect(result.iceServers[0].urls).toEqual(["stun:stun.example.test:3478"])
  expect(result.iceServers[1].urls).toEqual([
    "turn:relay.example.test:3478?transport=udp",
    "turns:relay.example.test:5349?transport=tcp",
  ])
  expect(result.iceServers[1].username).toBe(
    `${result.expiresAt! / 1000}:${f.row.leaseId}`
  )
  expect(result.expiresAt! / 1000).toBeGreaterThanOrEqual(before + 3600)
  expect(result.expiresAt! / 1000).toBeLessThanOrEqual(
    Math.floor(Date.now() / 1000) + 3600
  )
  const response = JSON.stringify(result)
  expect(response.includes(process.env.CALL_TURN_SECRET!)).toBe(false)
  expect(response.includes(f.owner.user._id)).toBe(false)
  expect(Object.keys(result).sort()).toEqual(["expiresAt", "iceServers"])
})

test("unsigned requests, outsiders, members without a lease and wrong browsers are denied", async () => {
  const f = await setup()
  await expect(
    f.t.action(api.calling.softphone.iceServers, f.args)
  ).rejects.toThrow()
  await expect(
    f.outsider.client.action(api.calling.softphone.iceServers, f.args)
  ).rejects.toThrow()
  await expect(
    f.member.client.action(api.calling.softphone.iceServers, f.args)
  ).rejects.toThrow("does not own")
  await expect(
    f.owner.client.action(api.calling.softphone.iceServers, {
      ...f.args,
      browserId: "other-browser",
    })
  ).rejects.toThrow("does not own")
  await f.t.run((ctx) =>
    ctx.db.patch("callAgents", f.row._id, { expiresAt: Date.now() - 1 })
  )
  await expect(
    f.owner.client.action(api.calling.softphone.iceServers, f.args)
  ).rejects.toThrow("Register")
})

test("TURN requires both env settings, and issuance is rate limited per agent", async () => {
  const f = await setup()
  vi.stubEnv("CALL_TURN_SECRET", "")
  const stunOnly = await f.owner.client.action(
    api.calling.softphone.iceServers,
    f.args
  )
  expect(stunOnly).toEqual({
    iceServers: [{ urls: ["stun:stun.example.test:3478"] }],
    expiresAt: null,
  })
  vi.stubEnv("CALL_TURN_SECRET", randomBytes(32).toString("hex"))
  vi.stubEnv("CALL_TURN_URLS", "")
  expect(
    await f.owner.client.action(api.calling.softphone.iceServers, f.args)
  ).toEqual(stunOnly)
  for (let i = 0; i < 4; i++)
    await f.owner.client.action(api.calling.softphone.iceServers, f.args)
  await expect(
    f.owner.client.action(api.calling.softphone.iceServers, f.args)
  ).rejects.toThrow()
})
