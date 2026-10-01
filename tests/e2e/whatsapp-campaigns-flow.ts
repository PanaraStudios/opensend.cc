import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import type { Doc } from "../../convex/_generated/dataModel"
import { backendRows, client } from "./ses-fixtures"

const PHONE = "106540352242922"
const WABA = "102290129340398"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const TEMPLATE = "e2e_order_update"
const screenshot = (page: Page, name: string) =>
  page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/whatsapp-campaigns-${name}.png`,
    fullPage: true,
  })
async function webhook(page: Page, value: unknown, field = "messages") {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: WABA, changes: [{ field, value }] }],
  })
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
async function choose(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function graphCalls(page: Page) {
  const calls: {
    method: string
    path: string
    body: {
      to: string
      template: {
        name: string
        components: { parameters: { text: string }[] }[]
      }
    }
  }[] = await (
    await page.request.get(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`)
  ).json()
  return calls.filter(
    (call) => call.method === "POST" && call.path === `/${PHONE}/messages`
  )
}

/** Runs directly after whatsappTemplatesTests; reuses its published template
 * and connected number. All sends go to the existing fake Graph messages route. */
export function whatsappCampaignsTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("WhatsApp broadcast previews and sends a phone audience, tracks receipts, and an inbound reply starts an automation", async () => {
    const { owner, organizationId } = state()
    const c = await client(owner)
    const template = backendRows<Doc<"templates">>("templates").find(
      (row) => row.organizationId === organizationId && row.name === TEMPLATE
    )!
    const account = backendRows<Doc<"channelAccounts">>("channelAccounts").find(
      (row) => row.organizationId === organizationId && row.externalId === PHONE
    )!
    // The preceding sync reads the fake server's PENDING submission. Apply
    // Meta's approval again so this lane always starts from an approved asset.
    await webhook(
      owner,
      {
        event: "APPROVED",
        message_template_id: Number(template.whatsapp!.metaTemplateId!),
        message_template_name: TEMPLATE,
        message_template_language: "en_US",
        reason: "NONE",
      },
      "message_template_status_update"
    )
    const segmentId = await c.mutation(api.segments.create, {
      organizationId,
      name: "WhatsApp campaigns E2E",
    })
    await c.mutation(api.contacts.upsert, {
      organizationId,
      segmentIds: [segmentId],
      contacts: [
        { phone: "+15550007001", firstName: "Alex" },
        { phone: "+15550007002", firstName: "Sam" },
        { email: "campaign-email-only@example.test" },
      ],
    })
    await owner.request.post(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__reset`)
    await owner.goto("/broadcasts")
    await owner.getByTestId("create-broadcast").first().click()
    await owner.getByRole("menuitem", { name: "WhatsApp", exact: true }).click()
    await owner.waitForURL(/\/broadcasts\/[^/]+\/edit$/)
    const broadcastId = new URL(owner.url()).pathname.split("/")[2]
    await owner.getByTestId("editor-name").fill("WhatsApp campaigns E2E")
    await owner.getByTestId("editor-name").press("Tab")
    await choose(
      owner,
      "Sending number",
      `${account.displayName} (${account.handle})`
    )
    await choose(owner, "Approved template", TEMPLATE)
    await owner
      .getByLabel("Source for {{1}}", { exact: true })
      .selectOption("contact")
    await choose(owner, "Contact field for {{1}}", "First name")
    await owner.getByLabel("Fallback for {{1}}", { exact: true }).fill("there")
    await choose(owner, "Audience", "WhatsApp campaigns E2E")
    await owner.getByRole("button", { name: "Save", exact: true }).click()
    await expect(owner.getByTestId("whatsapp-campaign-preview")).toContainText(
      "Hi Alex, your order is ready."
    )
    await screenshot(owner, "broadcast-form")
    await owner.getByTestId("whatsapp-broadcast-review").click()
    await expect(
      owner.getByTestId("whatsapp-broadcast-estimate")
    ).toContainText("2 recipients, 1 skipped")
    await expect(
      owner.getByTestId("whatsapp-broadcast-estimate")
    ).toContainText("1 skipped for lacking a phone")
    await owner
      .getByRole("button", { name: "Send broadcast", exact: true })
      .click()
    await owner.waitForURL(`/broadcasts/${broadcastId}`)
    await expect
      .poll(async () => (await graphCalls(owner)).length, { timeout: 30_000 })
      .toBe(2)
    const calls = await graphCalls(owner)
    expect(calls.map((call) => call.body.to).sort()).toEqual([
      "15550007001",
      "15550007002",
    ])
    expect(calls.map((call) => call.body.template.name)).toEqual([
      TEMPLATE,
      TEMPLATE,
    ])
    expect(
      calls
        .map((call) => call.body.template.components[0].parameters[0].text)
        .sort()
    ).toEqual(["Alex", "Sam"])
    await expect
      .poll(
        () =>
          backendRows<Doc<"channelMessages">>("channelMessages").filter(
            (row) => row.broadcastId === broadcastId && row.externalId
          ).length
      )
      .toBe(2)
    const messages = backendRows<Doc<"channelMessages">>(
      "channelMessages"
    ).filter((row) => row.broadcastId === broadcastId)
    await webhook(owner, {
      metadata: { phone_number_id: PHONE },
      statuses: messages.map((row) => ({
        id: row.externalId,
        status: "delivered",
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: row.to,
      })),
    })
    await expect(owner.getByTestId("whatsapp-stat-delivered")).toContainText(
      "2"
    )
    await webhook(owner, {
      metadata: { phone_number_id: PHONE },
      statuses: [
        {
          id: messages[0].externalId,
          status: "read",
          timestamp: String(Math.floor(Date.now() / 1000)),
          recipient_id: messages[0].to,
        },
      ],
    })
    await expect(owner.getByTestId("whatsapp-stat-read")).toContainText("1")
    await screenshot(owner, "broadcast-stats")

    await owner.goto("/automations")
    await owner
      .getByRole("button", { name: "Create automation", exact: true })
      .click()
    await owner.waitForURL(/\/automations\/[^/]+$/)
    const automationId = new URL(owner.url()).pathname.split("/")[2]
    await owner.getByTestId("workflow-node-start").click()
    await owner
      .getByRole("option", { name: "WhatsApp message received", exact: true })
      .click()
    await owner.getByTestId("workflow-add-step").last().click()
    await owner
      .getByRole("menuitem", { name: "Send WhatsApp", exact: true })
      .click()
    await choose(
      owner,
      "Sending number",
      `${account.displayName} (${account.handle})`
    )
    await choose(owner, "Approved template", TEMPLATE)
    await owner
      .getByLabel("Source for {{1}}", { exact: true })
      .selectOption("contact")
    await choose(owner, "Contact field for {{1}}", "First name")
    await owner.getByLabel("Fallback for {{1}}", { exact: true }).fill("there")
    await expect
      .poll(
        async () =>
          (
            await c.query(api.automations.get, {
              organizationId,
              id: automationId,
            })
          )?.graph
      )
      .toContain('"fallback":"there"')
    await screenshot(owner, "automation-builder")
    await owner.getByTestId("automation-toggle").click()
    await expect(owner.getByTestId("automation-toggle")).toContainText("Stop")
    const before = (await graphCalls(owner)).length
    await webhook(owner, {
      metadata: { phone_number_id: PHONE },
      contacts: [{ wa_id: "15550007001", profile: { name: "Alex" } }],
      messages: [
        {
          id: "wamid.campaign-reply",
          from: "15550007001",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Thanks" },
        },
      ],
    })
    await expect
      .poll(async () => (await graphCalls(owner)).length, { timeout: 30_000 })
      .toBe(before + 1)
    const automated = backendRows<Doc<"channelMessages">>(
      "channelMessages"
    ).find((row) => row.source === "automation" && row.to === "15550007001")!
    expect(automated.automationRunId).toBeDefined()
    expect(
      backendRows<Doc<"automationRuns">>("automationRuns").find(
        (run) => run._id === automated.automationRunId
      )?.automationId
    ).toBe(automationId)
    // Leave the suite with no enabled automation reacting to later fixtures.
    await c.mutation(api.automations.setStatus, {
      organizationId,
      id: automationId as Doc<"automations">["_id"],
      status: "disabled",
    })
  })
}
