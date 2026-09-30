import * as publicHttp from "../lib/net/public-fetch"
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, components } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { decryptSecret } from "./secrets"

const APP_ID = "1234567890"
const SECRET = "0123456789abcdef0123456789abcdef"
const CALLBACK = "https://api.opensend.test/meta/webhook"

let answer: (url: URL) => Response
let fetcher: ReturnType<typeof stubFetch>
const stubFetch = () =>
  vi
    .spyOn(publicHttp, "publicFetch")
    .mockImplementation(async (input) => answer(new URL(input)))

beforeEach(() => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  answer = () => Response.json({ id: APP_ID, name: "Opensend Test" })
  fetcher = stubFetch()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** The SES fixture plus a plain member of the admin's team. */
async function setup() {
  const f = await fixture()
  const member = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: member.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const save = (
    changes: Partial<{
      appId: string
      appSecret: string
      graphVersion: string
      configIds: { whatsapp?: string; facebookLogin?: string }
    }> = {}
  ) =>
    f.owner.client.action(api.meta.app.save, {
      appId: APP_ID,
      appSecret: SECRET,
      graphVersion: "v25.0",
      configIds: { whatsapp: "111", facebookLogin: "222" },
      ...changes,
    })
  const status = () => f.owner.client.query(api.meta.app.status, {})
  const stored = () => f.t.run((ctx) => ctx.db.query("metaApps").unique())
  return { ...f, member, save, status, stored }
}

describe("Meta app settings", () => {
  test("only the installation administrator can read or change them", async () => {
    const f = await setup()
    await f.save()
    for (const actor of [f.member, f.outsider]) {
      await expect(actor.client.query(api.meta.app.status, {})).rejects.toThrow(
        "installation administrator"
      )
      await expect(
        actor.client.action(api.meta.app.save, {
          appId: "999",
          appSecret: SECRET,
          graphVersion: "v25.0",
          configIds: {},
        })
      ).rejects.toThrow("installation administrator")
      await expect(
        actor.client.mutation(api.meta.app.disconnect, {})
      ).rejects.toThrow("installation administrator")
      await expect(
        actor.client.action(api.meta.appActions.verify, {})
      ).rejects.toThrow("installation administrator")
      await expect(
        actor.client.action(api.meta.appActions.subscribeWebhooks, {})
      ).rejects.toThrow("installation administrator")
    }
    expect((await f.stored())?.appId).toBe(APP_ID)
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("save stores encrypted credentials and status never shows the secret", async () => {
    const f = await setup()
    expect(await f.status()).toEqual({
      connected: false,
      graphVersion: "v25.0",
      configIds: {},
      callbackUrl: CALLBACK,
    })
    await expect(f.save({ appSecret: undefined })).rejects.toThrow(
      "Enter the app secret"
    )
    await expect(f.save({ appId: "app" })).rejects.toThrow("numeric app ID")
    await expect(f.save({ graphVersion: "25" })).rejects.toThrow("v25.0")
    await f.save()
    const status = await f.status()
    expect(status).toMatchObject({
      connected: true,
      appId: APP_ID,
      secretLast4: "cdef",
      graphVersion: "v25.0",
      configIds: { whatsapp: "111", facebookLogin: "222" },
      callbackUrl: CALLBACK,
    })
    expect(status.verifyToken).toMatch(/^os_/)
    expect(JSON.stringify(status)).not.toContain(SECRET)
    const row = (await f.stored())!
    expect(row.encryptedAppSecret).not.toContain(SECRET)
    expect(await decryptSecret(row.encryptedAppSecret)).toBe(SECRET)
    expect(await decryptSecret(row.encryptedVerifyToken)).toBe(
      status.verifyToken
    )

    // Later saves keep the secret and verify token unless replaced.
    await f.save({ appSecret: undefined, graphVersion: "v24.0" })
    expect(await f.status()).toMatchObject({
      secretLast4: "cdef",
      graphVersion: "v24.0",
      verifyToken: status.verifyToken,
    })
    // A different app needs its own secret.
    await expect(
      f.save({ appId: "987654321", appSecret: undefined })
    ).rejects.toThrow("Enter the app secret")

    await f.owner.client.mutation(api.meta.app.disconnect, {})
    expect(await f.stored()).toBeNull()
    expect((await f.status()).connected).toBe(false)
  })

  test("verify calls GET /{app-id} with the app access token and records the result", async () => {
    const f = await setup()
    await expect(
      f.owner.client.action(api.meta.appActions.verify, {})
    ).rejects.toThrow("Save the Meta app first")
    await f.save({ graphVersion: "v24.0" })
    await f.owner.client.action(api.meta.appActions.verify, {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]
    expect(String(url)).toBe(
      `https://graph.facebook.com/v24.0/${APP_ID}?fields=id%2Cname`
    )
    expect(options).toMatchObject({
      method: "GET",
      headers: { authorization: `Bearer ${APP_ID}|${SECRET}` },
      localOrigin: undefined,
    })
    expect(await f.status()).toMatchObject({
      appName: "Opensend Test",
      verifiedAt: expect.any(Number),
    })

    answer = () =>
      Response.json(
        {
          error: {
            message: "Error validating client secret.",
            type: "OAuthException",
            code: 1,
            fbtrace_id: "trace",
          },
        },
        { status: 400 }
      )
    await expect(
      f.owner.client.action(api.meta.appActions.verify, {})
    ).rejects.toThrow(
      "Meta refused the request: Error validating client secret."
    )
    expect((await f.status()).error).toBe(
      "Meta refused the request: Error validating client secret."
    )
  })

  test("a local fake Graph origin is honored only for a local HTTP origin", async () => {
    const f = await setup()
    await f.save()
    vi.stubEnv("META_GRAPH_ORIGIN", "http://host.docker.internal:4010")
    await f.owner.client.action(api.meta.appActions.verify, {})
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `http://host.docker.internal:4010/v25.0/${APP_ID}?fields=id%2Cname`
    )
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      localOrigin: "http://host.docker.internal:4010",
    })
    vi.stubEnv("META_GRAPH_ORIGIN", "https://graph.example.com")
    await f.owner.client.action(api.meta.appActions.verify, {})
    expect(String(fetcher.mock.calls[1][0])).toMatch(
      /^https:\/\/graph\.facebook\.com\//
    )
    expect(fetcher.mock.calls[1][1]).toMatchObject({ localOrigin: undefined })
  })

  test("subscribe posts the WhatsApp webhook subscription and records its time", async () => {
    const f = await setup()
    await f.save()
    answer = () => Response.json({ success: true })
    await f.owner.client.action(api.meta.appActions.subscribeWebhooks, {})
    const [url, options] = fetcher.mock.calls[0]
    expect(String(url)).toBe(
      `https://graph.facebook.com/v25.0/${APP_ID}/subscriptions`
    )
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Bearer ${APP_ID}|${SECRET}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    })
    const { verifyToken } = await f.status()
    expect(
      Object.fromEntries(new URLSearchParams(options!.body as string))
    ).toEqual({
      object: "whatsapp_business_account",
      callback_url: CALLBACK,
      verify_token: verifyToken,
      fields:
        "messages,message_template_status_update,template_category_update,phone_number_quality_update,account_update",
      include_values: "true",
    })
    expect((await f.status()).webhookSubscribedAt).toEqual(expect.any(Number))

    answer = () => Response.json({ success: false })
    await expect(
      f.owner.client.action(api.meta.appActions.subscribeWebhooks, {})
    ).rejects.toThrow("did not confirm")
  })

  test("GET /meta/webhook echoes the challenge only for the verify token", async () => {
    const f = await setup()
    const get = (query: Record<string, string>) =>
      f.t.fetch(`/meta/webhook?${new URLSearchParams(query)}`, {
        method: "GET",
      })
    // No app yet: nothing matches.
    expect(
      (
        await get({
          "hub.mode": "subscribe",
          "hub.verify_token": "anything",
          "hub.challenge": "1",
        })
      ).status
    ).toBe(403)
    await f.save()
    const { verifyToken } = await f.status()
    const ok = await get({
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken!,
      "hub.challenge": "1158201444",
    })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe("1158201444")
    const refused: Record<string, string>[] = [
      {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "1",
      },
      {
        "hub.mode": "unsubscribe",
        "hub.verify_token": verifyToken!,
        "hub.challenge": "1",
      },
      { "hub.mode": "subscribe", "hub.verify_token": verifyToken! },
    ]
    for (const query of refused) expect((await get(query)).status).toBe(403)
  })
})
