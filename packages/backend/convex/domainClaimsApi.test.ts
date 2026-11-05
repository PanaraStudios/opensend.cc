import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { patchRow } from "./counts"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "claim-api-test")
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No network")))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function setup() {
  const f = await fixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "domains", f.domain, { status: "verified" })
  )
  const key = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Claims", permission: "full_access", domainId: null },
  })
  const other = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Owner", permission: "full_access", domainId: null },
  })
  const sending = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Send", permission: "sending_access", domainId: null },
  })
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    token = key.token,
    idem?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idem ? { "Idempotency-Key": idem } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { ...f, call, key, other, sending }
}
describe("domain claims REST", () => {
  test("creates with 201, resumes with 200, replays both POSTs, and returns the documented 403 on ordinary creation", async () => {
    const f = await setup()
    const input = { name: "mail.example.test" }
    const conflict = await f.call("/domains", "POST", input)
    expect(conflict.status).toBe(403)
    expect(await conflict.json()).toMatchObject({
      name: "validation_error",
      message: "The mail.example.test domain has been registered already",
    })
    const created = await f.call(
      "/domains/claim",
      "POST",
      input,
      f.key.token,
      "claim-create"
    )
    expect(created.status).toBe(201)
    const claim = await created.json()
    const replay = await f.call(
      "/domains/claim",
      "POST",
      input,
      f.key.token,
      "claim-create"
    )
    expect(replay.status).toBe(201)
    expect(await replay.json()).toEqual(claim)
    const resumed = await f.call("/domains/claim", "POST", input)
    expect(resumed.status).toBe(200)
    expect(await resumed.json()).toEqual(claim)
    expect(
      await (await f.call(`/domains/${claim.domain_id}/claim`)).json()
    ).toEqual(claim)
    const verify = await f.call(
      `/domains/${claim.domain_id}/claim/verify`,
      "POST",
      undefined,
      f.key.token,
      "claim-verify"
    )
    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual(claim)
    expect(
      await (
        await f.call(
          `/domains/${claim.domain_id}/claim/verify`,
          "POST",
          undefined,
          f.key.token,
          "claim-verify"
        )
      ).json()
    ).toEqual(claim)
    const changed = await f.call(
      "/domains/claim",
      "POST",
      { ...input, custom_return_path: "other" },
      f.key.token,
      "claim-create"
    )
    expect(changed.status).toBe(409)
  })
  test("rejects sending keys on every endpoint and hides foreign ids", async () => {
    const f = await setup()
    const claim = await (
      await f.call("/domains/claim", "POST", { name: "mail.example.test" })
    ).json()
    for (const [path, method, body] of [
      ["/domains/claim", "POST", { name: "mail.example.test" }],
      [`/domains/${claim.domain_id}/claim`, "GET", undefined],
      [`/domains/${claim.domain_id}/claim/verify`, "POST", undefined],
    ] as const) {
      const denied = await f.call(path, method, body, f.sending.token)
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({ name: "restricted_api_key" })
    }
    for (const [path, method] of [
      [`/domains/${claim.domain_id}/claim`, "GET"],
      [`/domains/${claim.domain_id}/claim/verify`, "POST"],
    ]) {
      const foreign = await f.call(path, method, undefined, f.other.token)
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toMatchObject({ name: "not_found" })
    }
  })
  test("validates required name, region, tracking and Return-Path", async () => {
    const f = await setup()
    for (const input of [
      {},
      { name: "bad name" },
      { name: "mail.example.test", region: "moon" },
      { name: "mail.example.test", custom_return_path: "bad.name" },
      { name: "mail.example.test", tracking_subdomain: "send" },
    ]) {
      const result = await f.call("/domains/claim", "POST", input)
      expect(result.status).toBe(422)
      expect(await result.json()).toMatchObject({
        name: "name" in input ? "validation_error" : "missing_required_field",
      })
    }
  })
})
