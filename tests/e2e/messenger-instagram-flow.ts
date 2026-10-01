import { createHmac } from "node:crypto"
import { expect, test, type Page, type APIResponse } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"
import { createApiKey } from "./broadcast-received-flow"
const PAGE_ID = "555000100",
  IG_ID = "178414000001",
  PSID = "10000001",
  IGSID = "20000001"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const origin = () => process.env.OPENSEND_CALLBACK_ORIGIN!
const fake = () => process.env.OPENSEND_FAKE_GRAPH_URL!
async function webhook(
  page: Page,
  channel: "messenger" | "instagram",
  data: Record<string, unknown>
) {
  const id = channel === "messenger" ? PAGE_ID : IG_ID
  const body = JSON.stringify({
    object: channel === "messenger" ? "page" : "instagram",
    entry: [
      {
        id,
        messaging: [
          {
            sender: { id: channel === "messenger" ? PSID : IGSID },
            recipient: { id },
            timestamp: Date.now(),
            ...data,
          },
        ],
      },
    ],
  })
  const response = await page.request.post(`${origin()}/meta/webhook`, {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
    },
  })
  expect(response.status()).toBe(200)
}
export function messengerInstagramTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("Page connection receives Messenger/Instagram, replies through REST, records customer webhooks and displays channel icons", async () => {
    const { owner, organizationId } = state(),
      backend = await client(owner)
    const connected = await backend.action(
      api.meta.pageConnectActions.connectPageManual,
      {
        organizationId,
        pageId: PAGE_ID,
        token: "EAAPageE2EToken0123456789abcdef",
      }
    )
    expect(connected.accounts.map((a) => a.channel)).toEqual([
      "messenger",
      "instagram",
    ])
    const headers = await createApiKey(owner, "Messenger Instagram E2E")
    const customerWebhook = await backend.action(api.webhooks.create, {
      organizationId,
      endpoint: "https://page-messages.invalid/events",
      events: ["messenger.message.received"],
    })
    const rest = async (request: () => Promise<APIResponse>) => {
      for (let retry = 0; ; retry++) {
        const response = await request()
        if (response.status() !== 429 || retry >= 3) return response
        await owner.waitForTimeout(
          Math.max(1000, Number(response.headers()["retry-after"] ?? 1) * 1000)
        )
      }
    }
    const get = async (path: string) => {
      const response = await rest(() =>
        owner.request.get(`${origin()}${path}`, { headers })
      )
      expect(response.status()).toBe(200)
      return response.json()
    }
    try {
      await owner.request.post(`${fake()}/__reset`)
      for (const channel of ["messenger", "instagram"] as const) {
        const to = channel === "messenger" ? PSID : IGSID
        await webhook(owner, channel, {
          message: {
            mid: `mid.e2e.${channel}`,
            text: `${channel} inbound E2E`,
          },
        })
        await expect
          .poll(async () =>
            (await get(`/${channel}/messages`)).data.some(
              (m: { external_id: string }) =>
                m.external_id === `mid.e2e.${channel}`
            )
          )
          .toBe(true)
        const inbound = (await get(`/${channel}/messages`)).data.find(
          (m: { external_id: string }) => m.external_id === `mid.e2e.${channel}`
        )
        const conversations = await get(`/${channel}/conversations`)
        const conversation = conversations.data.find(
          (c: { id: string }) => c.id === inbound.conversation_id
        )
        expect(conversation.contact_id).toBeTruthy()
        expect(Date.parse(conversation.window_expires_at)).toBeGreaterThan(
          Date.now()
        )
        const request = {
          to,
          text: `${channel} reply E2E`,
          reply_to: inbound.id,
        }
        const sent = await rest(() =>
          owner.request.post(`${origin()}/${channel}/messages`, {
            headers: { ...headers, "Idempotency-Key": `e2e-${channel}` },
            data: request,
          })
        )
        expect(sent.status()).toBe(200)
        const { id } = await sent.json()
        const replay = await rest(() =>
          owner.request.post(`${origin()}/${channel}/messages`, {
            headers: { ...headers, "Idempotency-Key": `e2e-${channel}` },
            data: request,
          })
        )
        expect(await replay.json()).toEqual({ id })
        await expect
          .poll(async () => (await get(`/${channel}/messages/${id}`)).status, {
            timeout: 45000,
          })
          .toBe("sent")
        const message = await get(`/${channel}/messages/${id}`)
        if (channel === "messenger") {
          await webhook(owner, channel, {
            delivery: { mids: [message.external_id], watermark: Date.now() },
          })
          await expect
            .poll(async () => (await get(`/${channel}/messages/${id}`)).status)
            .toBe("delivered")
        }
        await webhook(owner, channel, {
          read:
            channel === "messenger"
              ? { watermark: Date.now() }
              : { mid: message.external_id },
        })
        await expect
          .poll(async () => (await get(`/${channel}/messages/${id}`)).status)
          .toBe("read")
        const calls = await (
          await owner.request.get(`${fake()}/__calls`)
        ).json()
        expect(
          calls.filter(
            (c: { path: string; body?: { recipient?: { id: string } } }) =>
              c.path === `/${PAGE_ID}/messages` && c.body?.recipient?.id === to
          )
        ).toHaveLength(1)
        expect(calls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: `/${PAGE_ID}/messages`,
              authorization: "Bearer EAAPageE2EToken0123456789abcdef",
              body: expect.objectContaining({
                recipient: { id: to },
                messaging_type: "RESPONSE",
                message: { text: request.text },
                reply_to: { mid: inbound.external_id },
              }),
            }),
          ])
        )
      }
      const closed = await rest(() =>
        owner.request.post(`${origin()}/messenger/messages`, {
          headers,
          data: { to: "999000001", text: "Window closed" },
        })
      )
      expect(closed.status()).toBe(422)
      expect((await closed.json()).message).toContain(
        "24-hour messaging window is closed"
      )
      await expect
        .poll(
          async () =>
            (
              await backend.query(api.webhooks.deliveries, {
                webhookId: customerWebhook,
                event: "messenger.message.received",
                paginationOpts: { cursor: null, numItems: 10 },
              })
            ).page.length
        )
        .toBeGreaterThan(0)
      await owner.goto("/contacts")
      await expect(
        // First and last name are separate columns.
        owner
          .getByRole("row")
          .filter({ hasText: "Ada" })
          .filter({ hasText: "E2E" })
      ).toBeVisible()
      await owner.goto("/channels")
      // The Instagram row names the same Page as its business.
      const messenger = owner
        .getByRole("row")
        .filter({ hasText: "Opensend Messenger E2E" })
        .filter({ hasNotText: "opensend_ig_e2e" })
      const instagram = owner
        .getByRole("row")
        .filter({ hasText: "opensend_ig_e2e" })
      await expect(messenger).toBeVisible()
      await expect(instagram).toBeVisible()
      // Lane 5B supplies the existing brand icons on these shared rows.
      await expect(messenger.locator("svg path").first()).toHaveAttribute(
        "d",
        /^M12 0/
      )
      await expect(instagram.locator("svg path").first()).toHaveAttribute(
        "d",
        /^M7/
      )
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/messenger-instagram-channels.png`,
        fullPage: true,
      })
    } finally {
      await backend.mutation(api.webhooks.remove, { id: customerWebhook })
    }
  })
}
