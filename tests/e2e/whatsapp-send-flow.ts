import { WABA, PHONE_ID } from "./meta-fixtures"
import { createHmac } from "node:crypto"
import { expect, test, type Page, type APIResponse } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"
import { createApiKey } from "./broadcast-received-flow"
const SENDER = "16505551234"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const origin = () => process.env.OPENSEND_CALLBACK_ORIGIN!
const fake = () => process.env.OPENSEND_FAKE_GRAPH_URL!
async function statusWebhook(page: Page, id: string, status: string) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PHONE_ID },
              statuses: [
                {
                  id,
                  status,
                  recipient_id: SENDER,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  })
  const response = await page.request.post(`${origin()}/meta/webhook`, {
    data: body,
    headers: {
      "content-type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
    },
  })
  expect(response.status()).toBe(200)
}
export function whatsappSendTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("UI API key sends WhatsApp, tracks webhook statuses, enforces window, uploads media and logs requests", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    const headers = await createApiKey(owner, "WhatsApp send E2E")
    await owner.request.post(`${fake()}/__reset`)
    const webhookId = await backend.action(api.webhooks.create, {
      organizationId,
      endpoint: "https://whatsapp-send.invalid/events",
      events: ["whatsapp.message.sent"],
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
    const post = (body: unknown, key?: string) =>
      rest(() =>
        owner.request.post(`${origin()}/whatsapp/messages`, {
          data: body,
          headers: { ...headers, ...(key ? { "Idempotency-Key": key } : {}) },
        })
      )
    const get = async (id: string) => {
      const response = await rest(() =>
        owner.request.get(`${origin()}/whatsapp/messages/${id}`, { headers })
      )
      expect(response.status()).toBe(200)
      return response.json()
    }
    try {
      const body = {
        from: PHONE_ID,
        to: SENDER,
        text: { body: "WhatsApp send E2E", preview_url: true },
      }
      const queued = await post(body, "whatsapp-e2e-send")
      expect(queued.status()).toBe(200)
      const { id } = await queued.json()
      expect(await (await post(body, "whatsapp-e2e-send")).json()).toEqual({
        id,
      })
      await expect
        .poll(async () => (await get(id)).status, { timeout: 45000 })
        .toBe("sent")
      const detail = await get(id)
      const calls = await (await owner.request.get(`${fake()}/__calls`)).json()
      expect(
        calls.filter(
          (call: { path: string }) => call.path === `/${PHONE_ID}/messages`
        )
      ).toHaveLength(1)
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "POST",
            path: `/${PHONE_ID}/messages`,
            version: "v25.0",
            body: {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: SENDER,
              type: "text",
              text: body.text,
            },
          }),
        ])
      )
      for (const status of ["delivered", "read"]) {
        await statusWebhook(owner, detail.external_id, status)
        await expect.poll(async () => (await get(id)).status).toBe(status)
      }
      const closed = await post({
        from: PHONE_ID,
        to: "16505550000",
        text: "Window closed",
      })
      expect(closed.status()).toBe(422)
      expect((await closed.json()).message).toContain(
        "24-hour customer service window is closed"
      )
      const template = await post({
        from: PHONE_ID,
        to: "16505550000",
        template: { name: "hello_world", language: "en_US" },
      })
      expect(template.status()).toBe(200)
      const templateId = (await template.json()).id
      await expect
        .poll(async () => (await get(templateId)).status, { timeout: 45000 })
        .toBe("sent")
      const media = await owner.request.post(`${origin()}/whatsapp/media`, {
        headers,
        multipart: {
          from: PHONE_ID,
          file: {
            name: "image.png",
            mimeType: "image/png",
            buffer: Buffer.from([255, 0, 128]),
          },
        },
      })
      expect(media.status()).toBe(200)
      const storage = await backend.query(api.storage.files.settings)
      expect(await media.json()).toMatchObject({ id: expect.any(String) })
      const mediaCalls = await (
        await owner.request.get(`${fake()}/__calls`)
      ).json()
      if (storage.provider === "convex")
        expect(mediaCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: "POST",
              path: `/${PHONE_ID}/media`,
              body: expect.stringContaining('name="messaging_product"'),
            }),
          ])
        )
      // The existing receiver pattern: .invalid never leaves the backend,
      // and the durable delivery record carries the signed payload.
      const deliveries = () =>
        backend.query(api.webhooks.deliveries, {
          webhookId,
          event: "whatsapp.message.sent",
          paginationOpts: { numItems: 10, cursor: null },
        })
      await expect
        .poll(
          async () =>
            (await deliveries()).page.filter(
              (delivery) =>
                (delivery.payload as { data?: { id?: string } }).data?.id === id
            ).length,
          { timeout: 45000 }
        )
        .toBe(1)
      const sentDelivery = (await deliveries()).page.find(
        (delivery) =>
          (delivery.payload as { data?: { id?: string } }).data?.id === id
      )!
      expect(sentDelivery.messageId).toMatch(/^msg_/)
      expect(sentDelivery.payload).toMatchObject({
        type: "whatsapp.message.sent",
        data: { id, channel: "whatsapp", status: "sent" },
      })
      await owner.request.post(`${fake()}/__responses`, {
        data: {
          method: "POST",
          path: `^/${PHONE_ID}/messages$`,
          status: 400,
          body: { error: { code: 131047, message: "Re-engagement message" } },
        },
      })
      const forced = await post({
        from: PHONE_ID,
        to: SENDER,
        text: "Forced error",
      })
      expect(forced.status()).toBe(200)
      const failedId = (await forced.json()).id
      await expect
        .poll(async () => (await get(failedId)).status, { timeout: 45000 })
        .toBe("failed")
      expect((await get(failedId)).error.code).toBe(131047)
      await owner.goto("/logs")
      await owner.getByPlaceholder("Search logs…").fill("/whatsapp/messages")
      const request = owner
        .getByRole("row")
        .filter({ hasText: "/whatsapp/messages" })
        .filter({ hasText: "POST" })
      await expect(request.first()).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/whatsapp-send-logs.png`,
        fullPage: true,
      })
    } finally {
      await owner.request.post(`${fake()}/__reset`)
      await backend.mutation(api.webhooks.remove, { id: webhookId })
    }
  })
}
