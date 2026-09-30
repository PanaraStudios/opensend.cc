import { expect, test, type Page } from "@playwright/test"
import { INSTANCE_PAGES } from "../../lib/dashboard/nav"

type State = { owner: Page; member: Page }
/** A request tests/e2e/fake-graph.mjs recorded. */
type GraphCall = {
  method: string
  version: string
  path: string
  query: Record<string, string>
  body?: unknown
  authorization?: string
}

const APP_ID = "1234567890123"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const WEBHOOK_FIELDS =
  "messages,message_template_status_update,template_category_update,phone_number_quality_update,account_update,phone_number_name_update"
const fakeGraph = () => process.env.OPENSEND_FAKE_GRAPH_URL!
/** Open menus close when a full-page capture resizes the viewport. */
const screenshot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/meta-app-${name}.png`,
    fullPage,
  })

async function graphCalls(page: Page): Promise<GraphCall[]> {
  return (await page.request.get(`${fakeGraph()}/__calls`)).json()
}

export function metaAppTests(state: () => State) {
  test("the installation admin connects the Meta app, verifies it and subscribes webhooks", async () => {
    const { owner } = state()
    const callbackUrl = `${process.env.OPENSEND_CALLBACK_ORIGIN}/meta/webhook`
    await owner.request.post(`${fakeGraph()}/__reset`)
    await owner.goto(INSTANCE_PAGES[1].href)
    const settings = owner.getByTestId("meta-settings")
    await expect(
      owner.getByRole("heading", { name: "Meta app", level: 1 })
    ).toBeVisible()
    await expect(
      // The status badge; the App ID row shows the same words until set.
      settings.getByText("Not connected", { exact: true }).first()
    ).toBeVisible()
    await screenshot(owner, "empty")

    await owner.getByRole("button", { name: "Add app", exact: true }).click()
    const dialog = owner.getByRole("dialog", { name: "Add Meta app" })
    await dialog.getByLabel("App ID", { exact: true }).fill(APP_ID)
    await dialog.getByLabel("App secret", { exact: true }).fill(APP_SECRET)
    await dialog
      .getByLabel("WhatsApp Embedded Signup config ID", { exact: true })
      .fill("111222333")
    await expect(
      dialog.getByLabel("Graph API version", { exact: true })
    ).toHaveValue("v25.0")
    await screenshot(owner, "form")
    await dialog.getByRole("button", { name: "Save app", exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await expect(settings.getByText("Connected", { exact: true })).toBeVisible()
    await expect(
      settings.getByText(`Ending in ${APP_SECRET.slice(-4)}`, { exact: true })
    ).toBeVisible()
    await expect(owner.getByText(APP_SECRET)).toHaveCount(0)
    await expect(settings.getByText(callbackUrl, { exact: true })).toBeVisible()
    await expect(settings.getByText("111222333", { exact: true })).toBeVisible()
    const token = settings.locator("code", { hasText: /^os_/ })
    await expect(token).toHaveText(/^os_[0-9a-z]{32}$/)
    const verifyToken = await token.innerText()

    // A refused secret is shown on the page; the fake answers Graph's 190.
    await owner.request.post(`${fakeGraph()}/__responses`, {
      data: {
        method: "GET",
        path: `^/${APP_ID}$`,
        status: 400,
        body: {
          error: {
            message: "Error validating client secret.",
            type: "OAuthException",
            code: 190,
          },
        },
      },
    })
    await settings.getByRole("button", { name: "Verify", exact: true }).click()
    await expect(
      settings
        .getByRole("alert")
        .filter({ hasText: "Error validating client secret." })
        .first()
    ).toBeVisible()
    await owner.request.post(`${fakeGraph()}/__reset`)

    await settings.getByRole("button", { name: "Verify", exact: true }).click()
    await expect(
      settings.getByText("App verified", { exact: true })
    ).toBeVisible()
    await expect(
      settings.getByText("Opensend E2E", { exact: true })
    ).toBeVisible()
    expect(await graphCalls(owner)).toEqual([
      {
        method: "GET",
        version: "v25.0",
        path: `/${APP_ID}`,
        query: { fields: "id,name" },
        authorization: `Bearer ${APP_ID}|${APP_SECRET}`,
      },
    ])

    await owner.request.post(`${fakeGraph()}/__reset`)
    await settings
      .getByRole("button", { name: "Subscribe", exact: true })
      .click()
    await expect(
      settings.getByText("Webhooks subscribed", { exact: true })
    ).toBeVisible()
    await expect(settings.getByText(/^Subscribed /)).toBeVisible()
    expect(await graphCalls(owner)).toEqual([
      {
        method: "POST",
        version: "v25.0",
        path: `/${APP_ID}/subscriptions`,
        query: {},
        body: {
          object: "whatsapp_business_account",
          callback_url: callbackUrl,
          verify_token: verifyToken,
          fields: WEBHOOK_FIELDS,
          include_values: "true",
        },
        authorization: `Bearer ${APP_ID}|${APP_SECRET}`,
      },
    ])
    await screenshot(owner, "connected")

    // Meta's callback check echoes the challenge only for the verify token.
    const verification = (token: string) =>
      owner.request.get(
        `${callbackUrl}?${new URLSearchParams({
          "hub.mode": "subscribe",
          "hub.verify_token": token,
          "hub.challenge": "123",
        })}`
      )
    const accepted = await verification(verifyToken)
    expect(accepted.status()).toBe(200)
    expect(await accepted.text()).toBe("123")
    expect((await verification("wrong-token")).status()).toBe(403)

    // The account menu lists every installation page.
    await owner
      .locator('[data-slot="sidebar-footer"]')
      .getByRole("button", { name: /Test Owner/ })
      .click()
    for (const page of INSTANCE_PAGES)
      await expect(
        owner.getByRole("menuitem", { name: page.title, exact: true })
      ).toHaveAttribute("href", page.href)
    await screenshot(owner, "account-menu", false)
    await owner.keyboard.press("Escape")
  })

  test("a team member without installation access sees the admin-required state", async () => {
    const { member } = state()
    await member.goto(INSTANCE_PAGES[1].href)
    await expect(
      member.getByText("Administrator access required", { exact: true })
    ).toBeVisible()
    await expect(member.getByTestId("meta-settings")).toHaveCount(0)
    await screenshot(member, "member")
  })
}
