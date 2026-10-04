import { connectWhatsApp, WABA } from "./meta-fixtures"
import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import type { Doc } from "../../convex/_generated/dataModel"
import { backendRows } from "./ses-fixtures"
import { choose } from "./whatsapp-campaigns-flow"

/** The connected WhatsApp account's WABA (meta-fixtures.ts), and the
    app secret metaAppTests saved. */
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const NAME = "e2e_order_update"
const BODY = "Hi {{1}}, your order is ready."

type GraphCall = { method: string; path: string; body?: unknown }
const fakeGraph = () => process.env.OPENSEND_FAKE_GRAPH_URL!
const toast = (page: Page) => page.locator('[data-slot="toast-viewport"]')
const screenshot = (page: Page, name: string) =>
  page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/whatsapp-templates-${name}.png`,
    fullPage: true,
  })
async function callsTo(page: Page, method: string, path: string) {
  const calls: GraphCall[] = await (
    await page.request.get(`${fakeGraph()}/__calls`)
  ).json()
  return calls.filter((call) => call.method === method && call.path === path)
}
/** A signed Meta webhook for the connected WABA. */
async function templateWebhook(page: Page, value: Record<string, unknown>) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        time: Math.floor(Date.now() / 1000),
        changes: [{ field: "message_template_status_update", value }],
      },
    ],
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
async function createTemplate(page: Page, kind: "Email" | "WhatsApp") {
  await page.goto("/templates")
  await page.getByTestId("create-template").click()
  await page.getByRole("menuitem", { name: kind, exact: true }).click()
  await page.waitForURL(/\/templates\/[^/]+$/)
}
async function filterChannel(page: Page, label: "All channels" | "WhatsApp") {
  await page.getByRole("combobox", { name: "Filter by channel" }).click()
  await page.getByRole("option", { name: label, exact: true }).click()
}

/** Runs after metaInboundTests, whose connected WhatsApp account stays
    connected to the owner's team. */
export function whatsappTemplatesTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("a WhatsApp template is written, submitted, approved by webhook and synced", async () => {
    const { owner, organizationId } = state()
    await connectWhatsApp(owner, organizationId)
    await owner.request.post(`${fakeGraph()}/__reset`)

    // The Templates list filters by channel.
    await owner.goto("/templates")
    await expect(
      owner.getByRole("combobox", { name: "Filter by channel" })
    ).toBeVisible()
    await expect(owner.getByTestId("sync-from-meta")).toBeVisible()
    await screenshot(owner, "list")

    // New → WhatsApp opens the WhatsApp editor.
    await createTemplate(owner, "WhatsApp")
    // The editor also renders a phone-only preview above the form (hidden here).
    await expect(
      owner
        .getByRole("complementary", { name: "Preview" })
        .getByTestId("whatsapp-preview")
    ).toBeVisible()
    await expect(owner.getByTestId("editor-name")).toHaveValue(
      /^untitled_template/
    )
    await owner.getByTestId("editor-name").fill(NAME)
    await owner.getByTestId("editor-name").press("Tab")
    await expect(owner.getByTestId("editor-name")).toHaveValue(NAME)
    await choose(owner, "Category", "Utility")
    await expect(
      owner.getByRole("combobox", { name: "Language", exact: true })
    ).toHaveText(/English \(US\)/)
    await owner.getByLabel("Body", { exact: true }).fill(BODY)
    await owner
      .getByLabel("Example for {{1}} in the body", { exact: true })
      .fill("Pablo")
    await owner.getByTestId("add-button").click()
    await owner.getByRole("menuitem", { name: "Quick reply" }).click()
    await owner.getByLabel("Button label", { exact: true }).fill("Thanks")
    const preview = owner
      .getByRole("complementary", { name: "Preview" })
      .getByTestId("whatsapp-preview")
    await expect(preview).toContainText("Hi Pablo, your order is ready.")
    await expect(preview).toContainText("Thanks")
    await expect(owner.getByTestId("save-indicator")).toHaveText("Saved")
    await screenshot(owner, "editor")
    await preview.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/whatsapp-templates-preview.png`,
    })

    // Publishing submits it to Meta; it waits for review.
    await owner.getByTestId("editor-publish").click()
    await expect(toast(owner)).toContainText("Template submitted to Meta")
    await expect(owner.getByTestId("editor-topbar")).toContainText("Pending")
    expect(
      (await callsTo(owner, "POST", `/${WABA}/message_templates`)).map(
        (call) => call.body
      )
    ).toEqual([
      {
        name: NAME,
        language: "en_US",
        category: "UTILITY",
        parameter_format: "positional",
        components: [
          { type: "BODY", text: BODY, example: { body_text: [["Pablo"]] } },
          {
            type: "BUTTONS",
            buttons: [{ type: "QUICK_REPLY", text: "Thanks" }],
          },
        ],
      },
    ])
    // Meta fixes a submitted template's name.
    await expect(owner.getByTestId("editor-name")).toHaveAttribute(
      "readonly",
      ""
    )

    // Meta approves it: its listing says so, and a webhook tells us. The
    // list shows Approved, and later syncs keep it approved.
    const row = backendRows<Doc<"templates">>("templates").find(
      (template) => template.name === NAME
    )!
    const metaTemplateId = row.whatsapp!.metaTemplateId!
    await owner.request.post(`${fakeGraph()}/__templates/${metaTemplateId}`, {
      data: { status: "APPROVED" },
    })
    await templateWebhook(owner, {
      event: "APPROVED",
      message_template_id: Number(metaTemplateId),
      message_template_name: NAME,
      message_template_language: "en_US",
      reason: "NONE",
    })
    await owner.goto("/templates")
    await filterChannel(owner, "WhatsApp")
    await owner.getByTestId("templates-layout-table").click()
    const listed = owner.getByRole("row").filter({ hasText: NAME })
    await expect(listed).toContainText("WhatsApp")
    await expect(listed).toContainText("Approved", { timeout: 30_000 })
    await screenshot(owner, "approved")

    // Sync from Meta imports a template made in WhatsApp Manager.
    await owner.getByTestId("sync-from-meta").click()
    await expect(toast(owner)).toContainText("Synced 2 WhatsApp templates")
    const synced = owner
      .getByRole("row")
      .filter({ hasText: "e2e_synced_offer" })
    await expect(synced).toContainText("Approved")
    await screenshot(owner, "synced")

    // An email template still opens the email editor.
    await createTemplate(owner, "Email")
    await expect(owner.getByTestId("editor-test-email")).toBeVisible()
    await expect(owner.getByTestId("whatsapp-preview")).toHaveCount(0)
    await screenshot(owner, "email-editor")
  })
}
