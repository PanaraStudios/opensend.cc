import { vi } from "vitest"
import * as publicHttp from "../../lib/net/public-fetch"
import { metaSignature } from "../../lib/meta/signature"
import { fixture } from "./ses.fixture"
import { encryptSecret } from "../secrets"
export { fixture }

/** Stub both Graph metadata and media downloads while retaining every call. */
export function fakeGraph(routes: Record<string, Response | (() => Response)>) {
  return vi
    .spyOn(publicHttp, "publicFetch")
    .mockImplementation(async (input) => {
      const url = new URL(input)
      const route = routes[url.pathname] ?? routes[url.href]
      if (!route) throw new Error(`No fake Graph route for ${url.pathname}`)
      return typeof route === "function" ? route() : route.clone()
    })
}
export async function signedWebhook(appSecret: string, payload: unknown) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload)
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": await metaSignature(appSecret, body),
    },
    body,
  }
}
export const APP_SECRET = "meta-inbound-app-secret"
export const PHONE_ID = "106540352242922"
export const WABA_ID = "102290129340398"
export const SENDER = "16505551234"
export const envelope = (
  value: unknown,
  field = "messages",
  wabaId = WABA_ID
) => ({
  object: "whatsapp_business_account",
  entry: [{ id: wabaId, changes: [{ field, value }] }],
})
export const incoming = (
  id = "wamid.inbound",
  timestamp = Math.floor(Date.now() / 1000)
) =>
  envelope({
    metadata: {
      phone_number_id: PHONE_ID,
      display_phone_number: "15550783881",
    },
    contacts: [{ wa_id: SENDER, profile: { name: "Sheena Nelson" } }],
    messages: [
      {
        from: SENDER,
        id,
        timestamp: String(timestamp),
        type: "text",
        text: { body: "Does it come in another color?" },
      },
    ],
  })

export async function metaFixture() {
  const f = await fixture()
  const encryptedToken = await encryptSecret("connection-test-token")
  const encryptedAppSecret = await encryptSecret(APP_SECRET)
  const account = await f.t.run(async (ctx) => {
    await ctx.db.insert("metaApps", {
      key: "metaApp",
      appId: "123",
      graphVersion: "v25.0",
      configIds: {},
      encryptedAppSecret,
      encryptedVerifyToken: encryptedAppSecret,
      secretLast4: "cret",
    })
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId: f.owner.team,
      businessId: "business",
      businessName: "Test",
      method: "manual_token",
      encryptedToken,
      tokenLast4: "oken",
      scopes: [],
      status: "active",
    })
    await ctx.db.insert("whatsappBusinessAccounts", {
      organizationId: f.owner.team,
      wabaId: WABA_ID,
      connectionId,
    })
    return await ctx.db.insert("channelAccounts", {
      organizationId: f.owner.team,
      channel: "whatsapp",
      externalId: PHONE_ID,
      connectionId,
      wabaId: WABA_ID,
      displayName: "Lucky Shrub",
      handle: "+15550783881",
      status: "active",
      quality: "green",
      throughputMps: 80,
    })
  })
  return { ...f, account }
}
