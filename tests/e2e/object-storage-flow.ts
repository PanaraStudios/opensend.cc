import { createHmac } from "node:crypto"
import { test, expect, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"
import { createApiKey } from "./broadcast-received-flow"
import { connectWhatsApp, PHONE_ID, WABA } from "./meta-fixtures"

export function objectStorageTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("dashboard and REST transfer bucket media, including a document over 20 MB", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    await connectWhatsApp(owner, organizationId)
    const name = "Object Storage Customer",
      customer = "16505559991"
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
                contacts: [{ wa_id: customer, profile: { name } }],
                messages: [
                  {
                    id: "wamid.object-storage",
                    from: customer,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Send the files" },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    expect(
      (
        await owner.request.post(
          `${process.env.OPENSEND_CALLBACK_ORIGIN}/meta/webhook`,
          {
            data: body,
            headers: {
              "Content-Type": "application/json",
              "X-Hub-Signature-256": `sha256=${createHmac("sha256", "e2e0123456789abcdef0123456789abc").update(body).digest("hex")}`,
            },
          }
        )
      ).status()
    ).toBe(200)
    await owner.goto("/emails/inbox")
    await owner.getByTestId("conversation").filter({ hasText: name }).click()
    await owner.request.post(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__reset`)
    for (const file of [
      {
        name: "bucket-image.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71]),
      },
      {
        name: "large-document.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(21 * 1024 * 1024, 65),
      },
    ]) {
      const requests: string[] = []
      const record = (request: import("@playwright/test").Request) => {
        if (request.method() === "PUT") requests.push(request.url())
      }
      owner.on("request", record)
      await owner.getByLabel("Attach file", { exact: true }).setInputFiles(file)
      await expect(
        owner.getByRole("button", { name: `Remove ${file.name}` })
      ).toBeVisible({ timeout: 45_000 })
      owner.off("request", record)
      expect(requests.some((url) => url.includes("X-Amz-Signature"))).toBe(true)
      await owner.getByLabel("Reply", { exact: true }).fill(file.name)
      await owner.getByRole("button", { name: "Send", exact: true }).click()
      const bubble = owner
        .getByTestId("thread-message")
        .filter({ hasText: file.name })
      await expect(bubble.getByTestId("message-status")).toHaveText("Sent", {
        timeout: 45_000,
      })
      await expect(bubble.getByLabel(`Download ${file.name}`)).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/object-storage-${file.name}.png`,
        fullPage: true,
      })
    }
    const calls = await (
      await owner.request.get(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`)
    ).json()
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `/${PHONE_ID}/messages`,
          body: expect.objectContaining({
            image: expect.objectContaining({
              link: expect.stringContaining("X-Amz-Signature"),
            }),
          }),
        }),
        expect.objectContaining({
          path: `/${PHONE_ID}/messages`,
          body: expect.objectContaining({
            document: expect.objectContaining({
              link: expect.stringContaining("X-Amz-Signature"),
            }),
          }),
        }),
      ])
    )
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fetchedMedia: expect.objectContaining({
            size: 21 * 1024 * 1024,
            contentType: "application/pdf",
          }),
        }),
      ])
    )
    expect(
      calls.filter(
        (call: { path: string }) => call.path === `/${PHONE_ID}/media`
      )
    ).toHaveLength(0)
    // Exercise the CRM upload contract independently of dashboard actions.
    const headers = await createApiKey(owner, "Object storage E2E")
    const pending = await owner.request.post(
      `${process.env.OPENSEND_CALLBACK_ORIGIN}/media/uploads`,
      {
        headers,
        data: {
          use: "whatsapp",
          from: PHONE_ID,
          filename: "api-image.png",
          content_type: "image/png",
          size: 3,
        },
      }
    )
    expect(pending.status()).toBe(200)
    const upload = await pending.json()
    const url = upload.upload_url.replace("host.docker.internal", "127.0.0.1")
    expect(
      (
        await owner.request.put(url, {
          data: Buffer.from([1, 2, 3]),
          headers: {
            "Content-Type": "image/png",
            Host: new URL(upload.upload_url).host,
          },
        })
      ).status()
    ).toBe(200)
    expect(
      (
        await owner.request.post(
          `${process.env.OPENSEND_CALLBACK_ORIGIN}/media/uploads/${upload.id}/complete`,
          { headers, data: {} }
        )
      ).status()
    ).toBe(200)
    const sent = await owner.request.post(
      `${process.env.OPENSEND_CALLBACK_ORIGIN}/whatsapp/messages`,
      {
        headers,
        data: { from: PHONE_ID, to: customer, image: { id: upload.id } },
      }
    )
    expect(sent.status()).toBe(200)
    const id = (await sent.json()).id
    await expect
      .poll(
        async () =>
          (await backend.query(api.messages.get, { id }))?.message.status,
        { timeout: 45_000 }
      )
      .toBe("sent")
    await owner.goto("/instance/meta")
    await expect(owner.getByText(/S3-compatible · opensend-e2e/)).toBeVisible()
  })
}
