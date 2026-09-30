import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { client, backendRows, testBackendValue } from "./ses-fixtures"

const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const PHONE_ID = "106540352242922"
const SENDER = "16505551234"
const envelope = (value: unknown) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            metadata: {
              phone_number_id: PHONE_ID,
              display_phone_number: "15550783881",
            },
            ...(value as object),
          },
        },
      ],
    },
  ],
})
const message = (id: string, type = "text") =>
  envelope({
    contacts: [{ wa_id: SENDER, profile: { name: "Sheena Nelson" } }],
    messages: [
      {
        from: SENDER,
        id,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type,
        ...(type === "text"
          ? { text: { body: "Inbound WhatsApp lane 2B" } }
          : { image: { id: "meta-inbound-media", mime_type: "image/png" } }),
      },
    ],
  })
async function post(page: Page, payload: unknown) {
  const body = JSON.stringify(payload)
  const response = await page.request.post(
    `${process.env.OPENSEND_CALLBACK_ORIGIN}/meta/webhook`,
    {
      data: body,
      headers: {
        "content-type": "application/json",
        "X-Hub-Signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
      },
    }
  )
  expect(response.status()).toBe(200)
}
export function metaInboundTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("projects signed replies, dedupes, creates an Audience contact, delivers customer events, applies statuses and stores media", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    const accountId = testBackendValue<Id<"channelAccounts">>(
      "meta/fixtures:seedAccount",
      { organizationId }
    )
    const webhookId = await backend.action(api.webhooks.create, {
      organizationId,
      endpoint: "https://meta-inbound.invalid/received",
      events: ["whatsapp.message.received"],
    })
    try {
      const unsigned = await owner.request.post(
        `${process.env.OPENSEND_CALLBACK_ORIGIN}/meta/webhook`,
        { data: message("wamid.e2e-unsigned") }
      )
      expect(unsigned.status()).toBe(401)
      const payload = message("wamid.e2e-inbound")
      await post(owner, payload)
      await post(owner, payload)
      const inbound = () =>
        backendRows<Doc<"channelMessages">>("channelMessages").filter(
          (m) => m.externalId === "wamid.e2e-inbound"
        )
      await expect.poll(() => inbound().length).toBe(1)
      expect(inbound()[0]).toMatchObject({
        status: "received",
        direction: "inbound",
      })
      const deliveries = () =>
        backend.query(api.webhooks.deliveries, {
          webhookId,
          event: "whatsapp.message.received",
          paginationOpts: { numItems: 10, cursor: null },
        })
      await expect.poll(async () => (await deliveries()).page.length).toBe(1)
      expect((await deliveries()).page[0].payload).toMatchObject({
        type: "whatsapp.message.received",
        data: {
          id: inbound()[0]._id,
          channel: "whatsapp",
          text: "Inbound WhatsApp lane 2B",
          status: "received",
        },
      })
      // The existing receiver pattern inspects the durable customer delivery;
      // .invalid keeps the integration test from contacting an external host.
      await owner.goto("/contacts")
      await owner.getByPlaceholder("Search contacts…").fill("6505551234")
      const contact = owner.getByRole("row").filter({ hasText: "+16505551234" })
      await expect(contact).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/meta-inbound-audience.png`,
        fullPage: true,
      })
      await contact
        .getByRole("link", { name: "+16505551234", exact: true })
        .click()
      await expect(owner.getByLabel("Phone", { exact: true })).toHaveValue(
        "+16505551234"
      )
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/meta-inbound-contact.png`,
        fullPage: true,
      })
      const outboundId = testBackendValue<string>(
        "meta/fixtures:seedOutbound",
        { accountId, externalId: "wamid.e2e-outbound" }
      )
      for (const status of ["delivered", "read"]) {
        await post(
          owner,
          envelope({
            statuses: [
              {
                id: "wamid.e2e-outbound",
                status,
                timestamp: String(Math.floor(Date.now() / 1000)),
                recipient_id: SENDER,
              },
            ],
          })
        )
        await expect
          .poll(
            () =>
              backendRows<Doc<"channelMessages">>("channelMessages").find(
                (m) => m._id === outboundId
              )?.status
          )
          .toBe(status)
      }
      await owner.request.post(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__reset`)
      await post(owner, message("wamid.e2e-image", "image"))
      await expect
        .poll(
          () => {
            const mediaMessage = backendRows<Doc<"channelMessages">>(
              "channelMessages"
            ).find((m) => m.externalId === "wamid.e2e-image")
            return backendRows<Doc<"channelMessageContents">>(
              "channelMessageContents"
            ).find((c) => c.messageId === mediaMessage?._id)?.media?.[0]
              .storageId
          },
          { timeout: 45000 }
        )
        .toBeTruthy()
      const calls = await (
        await owner.request.get(
          `${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`
        )
      ).json()
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: "/meta-inbound-media",
            version: "v25.0",
            authorization: "Bearer meta-inbound-e2e-token",
          }),
          expect.objectContaining({
            method: "GET",
            path: "/media-download/meta-inbound-media",
            authorization: "Bearer meta-inbound-e2e-token",
          }),
        ])
      )
      const contents = backendRows<Doc<"channelMessageContents">>(
        "channelMessageContents"
      ).find((c) => JSON.parse(c.payload).id === "wamid.e2e-image")!
      expect(contents.media![0]).toMatchObject({
        size: 3,
        contentType: "image/png",
      })
    } finally {
      await backend.mutation(api.webhooks.remove, { id: webhookId })
    }
  })
}
