import { vi } from "vitest"
import * as publicHttp from "../../lib/net/public-fetch"
import { api, internal, components } from "../_generated/api"
import { metaSignature } from "../../lib/meta/signature"
import { insertRow } from "../counts"
import { fixture } from "./ses.fixture"
import { encryptSecret } from "../secrets"
import type { Id } from "../_generated/dataModel"

/** The Meta app metaFixture saves. */
export const META_APP = {
  appId: "1234567890",
  appSecret: "0123456789abcdef0123456789abcdef",
  graphVersion: "v25.0",
  configIds: { whatsapp: "111", facebookLogin: "222" },
}

/** One Graph request, as the fake recorded it. */
export type GraphCall = {
  method: string
  version: string
  /** Without the version: `/123/subscribed_apps`. */
  path: string
  query: Record<string, string>
  /** Parsed JSON or form fields; raw text otherwise. */
  body?: unknown
  authorization?: string
}
/** A canned answer: a JSON body, or a whole Response (errors, statuses). */
export type GraphRoute = {
  method?: GraphCall["method"]
  /** The path without the version: exact, or a pattern. */
  path: string | RegExp
  respond: (call: GraphCall, match: RegExpExecArray | null) => unknown
}

/** Graph's error body, with its HTTP status. */
export const graphError = (message: string, code: number, status = 400) =>
  Response.json(
    { error: { message, type: "OAuthException", code, fbtrace_id: "test" } },
    { status }
  )

function parseBody(raw: string | Uint8Array | undefined, type = "") {
  if (raw === undefined) return undefined
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
  if (type.includes("application/json")) return JSON.parse(text) as unknown
  if (type.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(text))
  return text
}

/** Answers every publicFetch from `routes`, first match wins, and records
    the calls; an unmatched call gets Graph's error 100. `use` puts routes
    ahead of the others, to override an answer for one test. Restore with
    `vi.restoreAllMocks()`. */
export function fakeGraph(routes: GraphRoute[] = []) {
  const calls: GraphCall[] = []
  let table = [...routes]
  const spy = vi
    .spyOn(publicHttp, "publicFetch")
    .mockImplementation(async (input, options = {}) => {
      const url = new URL(input)
      const [, version = "", path = url.pathname] =
        /^\/(v\d+\.\d+)(\/.*)$/.exec(url.pathname) ?? []
      const call: GraphCall = {
        method: options.method ?? "GET",
        version,
        path,
        query: Object.fromEntries(url.searchParams),
        body: parseBody(options.body, options.headers?.["content-type"]),
        authorization: options.headers?.authorization,
      }
      calls.push(call)
      for (const route of table) {
        if (route.method && route.method !== call.method) continue
        let match: RegExpExecArray | null = null
        if (typeof route.path === "string") {
          if (route.path !== path) continue
        } else if (!(match = route.path.exec(path))) continue
        const answer = route.respond(call, match)
        return answer instanceof Response ? answer : Response.json(answer)
      }
      return graphError(`No fake route for ${call.method} ${path}`, 100)
    })
  return {
    calls,
    spy,
    use(...more: GraphRoute[]) {
      table = [...more, ...table]
    },
    /** The calls to paths matching `path`. */
    to(path: string | RegExp, method?: string) {
      return calls.filter(
        (call) =>
          (!method || call.method === method) &&
          (typeof path === "string" ? call.path === path : path.test(call.path))
      )
    },
  }
}

/** The SES fixture with a plain member on the owner's team and the Meta app
    saved by the installation admin (the owner). Stub SSO_ENCRYPTION_KEY
    first, as secrets are encrypted with it. */
export async function metaFixture() {
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
  await f.owner.client.action(api.meta.app.save, META_APP)
  await f.owner.client.mutation(internal.meta.app.record, {
    appId: META_APP.appId,
    verifiedAt: Date.now(),
    webhookSubscribedAt: Date.now(),
  })
  return { ...f, member }
}

/** A signed Meta webhook request for `t.fetch("/meta/webhook", …)`. */
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
export const APP_SECRET = META_APP.appSecret
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

/** metaFixture plus one connected WhatsApp number on the owner's team, so
    webhooks for PHONE_ID and WABA_ID route to it. */
export async function inboundFixture() {
  const f = await metaFixture()
  const encryptedToken = await encryptSecret("connection-test-token")
  const account = await f.t.run(async (ctx) => {
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
    return (await insertRow(ctx, "channelAccounts", {
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
    })) as Id<"channelAccounts">
  })
  return { ...f, account }
}
