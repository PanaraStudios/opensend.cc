import { playgroundShots } from "./playground-shots"
import { createHmac } from "node:crypto"
import { expect, test, type APIResponse, type Page } from "@playwright/test"
import { connectWhatsApp, PHONE_ID, WABA } from "./meta-fixtures"

export function apiKeyScopesTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("creates a Custom CRM key, sends WhatsApp, refuses contact writes, and edits scopes", async () => {
    const { owner, organizationId } = state()
    await connectWhatsApp(owner, organizationId)
    const origin = process.env.OPENSEND_CALLBACK_ORIGIN!
    const graphOrigin = process.env.OPENSEND_FAKE_GRAPH_URL!
    await owner.goto("/api-keys")
    await owner
      .getByRole("button", { name: "Create API key", exact: true })
      .first()
      .click()
    const dialog = owner.getByRole("dialog", {
      name: "Create API key",
      exact: true,
    })
    await dialog.getByLabel("Name", { exact: true }).fill("Custom CRM E2E")
    await dialog.getByLabel("Permission", { exact: true }).click()
    await owner.getByRole("option", { name: "Custom", exact: true }).click()
    await expect(dialog.getByLabel("Domain", { exact: true })).toHaveCount(0)
    await dialog
      .getByRole("button", { name: "Set all to Read", exact: true })
      .click()
    await expect(
      dialog.getByRole("button", { name: "Emails Read", exact: true })
    ).toHaveAttribute("aria-pressed", "true")
    await dialog.getByRole("button", { name: "Clear", exact: true }).click()
    await dialog.getByRole("button", { name: "Create", exact: true }).click()
    await expect(
      dialog.getByText(
        "Choose at least one resource scope for a Custom API key"
      )
    ).toBeVisible()
    await dialog
      .getByRole("button", { name: "Emails Write", exact: true })
      .click()
    await expect(dialog.getByLabel("Domain", { exact: true })).toBeVisible()
    await dialog
      .getByRole("button", { name: "Emails None", exact: true })
      .click()
    await dialog
      .getByRole("button", { name: "WhatsApp Write", exact: true })
      .click()
    await dialog
      .getByRole("button", { name: "Contacts Read", exact: true })
      .click()
    await expect(
      dialog.getByText("Calling", { exact: true }).first()
    ).toBeVisible()
    const selected = dialog.getByRole("button", {
      name: "WhatsApp Write",
      exact: true,
    })
    await expect(selected).toHaveAttribute("aria-pressed", "true")
    await expect
      .poll(() =>
        selected.evaluate((element) => {
          const style = getComputedStyle(element)
          return (
            style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            style.color !== style.backgroundColor
          )
        })
      )
      .toBe(true)
    await playgroundShots(owner, "api-key-scopes")
    await dialog.getByRole("button", { name: "Create", exact: true }).click()
    const reveal = owner.getByRole("dialog", {
      name: "View API Key",
      exact: true,
    })
    await reveal
      .getByRole("button", { name: "Show API key", exact: true })
      .click()
    const token = await reveal
      .getByLabel("API key", { exact: true })
      .inputValue()
    await reveal.getByRole("button", { name: "Done", exact: true }).click()
    const row = owner.getByRole("row").filter({ hasText: "Custom CRM E2E" })
    await expect(
      row.getByText("Custom · 2 scopes", { exact: true })
    ).toBeVisible()
    const headers = { Authorization: `Bearer ${token}` }
    const rest = async (request: () => Promise<APIResponse>) => {
      for (let retry = 0; ; retry++) {
        const response = await request()
        if (response.status() !== 429 || retry >= 3) return response
        await owner.waitForTimeout(
          Math.max(1000, Number(response.headers()["retry-after"] ?? 1) * 1000)
        )
      }
    }
    expect(
      (
        await rest(() => owner.request.get(`${origin}/contacts`, { headers }))
      ).status()
    ).toBe(200)
    const refused = await rest(() =>
      owner.request.post(`${origin}/contacts`, {
        headers,
        data: { email: "scoped-crm@example.test" },
      })
    )
    expect(refused.status()).toBe(403)
    expect(await refused.json()).toMatchObject({
      name: "restricted_api_key",
      message: "This API key needs the `contacts:write` scope.",
    })
    // Open a fresh customer service window through the real signed webhook.
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
                contacts: [
                  { wa_id: "16505551234", profile: { name: "Scoped CRM" } },
                ],
                messages: [
                  {
                    id: "wamid.api-key-scopes-inbound",
                    from: "16505551234",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Open CRM window" },
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
        await owner.request.post(`${origin}/meta/webhook`, {
          data: body,
          headers: {
            "content-type": "application/json",
            "X-Hub-Signature-256": `sha256=${createHmac("sha256", "e2e0123456789abcdef0123456789abc").update(body).digest("hex")}`,
          },
        })
      ).status()
    ).toBe(200)
    await expect
      .poll(
        async () => {
          const result = await rest(() =>
            owner.request.get(`${origin}/whatsapp/conversations`, { headers })
          )
          expect(result.status()).toBe(200)
          return (await result.json()).data.some(
            (c: { last_preview: string }) =>
              c.last_preview === "Open CRM window"
          )
        },
        { timeout: 30000 }
      )
      .toBe(true)
    const sent = await rest(() =>
      owner.request.post(`${origin}/whatsapp/messages`, {
        headers,
        data: {
          from: PHONE_ID,
          to: "16505551234",
          text: { body: "Custom CRM scopes E2E" },
        },
      })
    )
    expect(sent.status()).toBe(200)
    const { id } = await sent.json()
    await expect
      .poll(
        async () => {
          const response = await rest(() =>
            owner.request.get(`${origin}/whatsapp/messages/${id}`, { headers })
          )
          expect(response.status()).toBe(200)
          return (await response.json()).status
        },
        { timeout: 45000 }
      )
      .toBe("sent")
    const calls = await (
      await owner.request.get(`${graphOrigin}/__calls`)
    ).json()
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: `/${PHONE_ID}/messages`,
          version: "v25.0",
          body: expect.objectContaining({
            text: { body: "Custom CRM scopes E2E" },
          }),
        }),
      ])
    )
    await row.getByRole("link", { name: "Custom CRM E2E", exact: true }).click()
    await owner.waitForURL(/\/api-keys\/[^/?]+$/)
    await owner
      .getByRole("button", { name: "More options", exact: true })
      .click()
    await owner
      .getByRole("menuitem", { name: "Edit API key", exact: true })
      .click()
    const edit = owner.getByRole("dialog", {
      name: "Edit API Key",
      exact: true,
    })
    await expect(
      edit.getByRole("button", { name: "WhatsApp Write", exact: true })
    ).toHaveAttribute("aria-pressed", "true")
    await edit
      .getByRole("button", { name: "Contacts Write", exact: true })
      .click()
    await edit.getByRole("button", { name: "Save", exact: true }).click()
    const contact = await rest(() =>
      owner.request.post(`${origin}/contacts`, {
        headers,
        data: { email: "scoped-crm@example.test" },
      })
    )
    expect(contact.status()).toBe(201)
    const created = await contact.json()
    expect(
      (
        await rest(() =>
          owner.request.delete(`${origin}/contacts/${created.id}`, { headers })
        )
      ).status()
    ).toBe(200)
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/api-key-scopes-detail.png`,
      fullPage: true,
    })
  })
}
