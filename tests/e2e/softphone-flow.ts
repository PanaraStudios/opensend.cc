import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { connectWhatsApp, WABA, PHONE_ID } from "./meta-fixtures"
import { createApiKey } from "./broadcast-received-flow"
import { client, testBackend } from "./ses-fixtures"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
const BSUID = "US.13491208655302741919"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
export function softphoneTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("softphone away state, Calls tab, missed bubble and contact permission request", async () => {
    const { owner, organizationId } = state()
    const accountId = await connectWhatsApp(owner, organizationId)
    const backend = await client(owner)
    await backend.action(api.calling.settings.dashboardUpdate, {
      organizationId,
      from: accountId,
      mode: "api",
    })
    const headers = await createApiKey(owner, "Softphone E2E")
    const origin = process.env.OPENSEND_CALLBACK_ORIGIN!
    const wacid = `wacid.softphone.${Date.now()}`
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA,
          changes: [
            {
              field: "calls",
              value: {
                metadata: { phone_number_id: PHONE_ID },
                contacts: [
                  { user_id: BSUID, profile: { name: "Softphone caller" } },
                ],
                calls: [
                  {
                    id: wacid,
                    event: "terminate",
                    direction: "USER_INITIATED",
                    from_user_id: BSUID,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    // Meta reports an unanswered call as FAILED with no duration.
                    status: ["FAILED"],
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    const signature = createHmac("sha256", APP_SECRET)
      .update(body)
      .digest("hex")
    expect(
      (
        await owner.request.post(`${origin}/meta/webhook`, {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": `sha256=${signature}`,
          },
        })
      ).status()
    ).toBe(200)
    let contactId: Id<"contacts"> | null = null
    await expect
      .poll(async () => {
        const calls = await (
          await owner.request.get(`${origin}/whatsapp/calls`, { headers })
        ).json()
        const row = calls.data.find((c: { wacid: string }) => c.wacid === wacid)
        contactId = row?.contact_id ?? null
        return row?.status
      })
      .toBe("missed")
    await owner.goto("/emails/calls")
    await expect(owner).toHaveURL(/\/playground\/calls$/)
    await expect(
      owner.getByRole("heading", { name: "Playground", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("tab", { name: "Calls", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("button", { name: "Open softphone", exact: true })
    ).toHaveCount(0)
    // A gateway-mode number enables the entry even when the gateway is offline.
    testBackend("calling/settingsState:store", {
      accountId,
      mode: "gateway",
      settings: "{}",
    })
    await expect(
      owner.getByRole("button", { name: "Go online", exact: true })
    ).toBeVisible()
    const header = owner
      .getByRole("heading", { name: "Playground", exact: true })
      .locator("../..")
    await expect(
      header.getByRole("button", { name: "Go online", exact: true })
    ).toBeVisible()
    await expect(header.locator('[aria-label="Softphone"]')).toHaveCount(1)
    await expect(
      header.getByRole("link", { name: "Calls", exact: true })
    ).toHaveCount(0)
    await expect(
      owner.getByText("Missed", { exact: true }).first()
    ).toBeVisible()
    await owner.getByRole("button", { name: "Softphone", exact: true }).click()
    await expect(
      owner.getByText("Go online to receive and make calls", { exact: true })
    ).toBeVisible()
    await owner.getByRole("button", { name: "Close", exact: true }).click()
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/softphone-calls.png`,
      fullPage: true,
    })
    expect(contactId).toBeTruthy()
    await owner.goto(`/contacts/${contactId}`)
    await expect(owner.locator('[aria-label="Softphone"]')).toHaveCount(0)
    const entry = owner
      .locator('[data-slot="sidebar-footer"]')
      .getByRole("button", { name: "Open softphone", exact: true })
    await expect(entry).toBeVisible()
    await entry.click()
    await expect(
      owner.getByRole("switch", { name: "Online", exact: true })
    ).not.toBeChecked()
    await expect(
      owner.getByRole("combobox", { name: "Softphone microphone", exact: true })
    ).toContainText("Default microphone")
    await expect(
      owner.getByRole("link", { name: "View calls", exact: true })
    ).toHaveAttribute("href", "/playground/calls")
    await expect(
      owner.getByText("Go online to receive and make calls", { exact: true })
    ).toBeVisible()
    await owner.getByRole("button", { name: "Close", exact: true }).click()
    testBackend("calling/settingsState:store", {
      accountId,
      mode: "api",
      settings: "{}",
    })
    await expect(entry).toHaveCount(0)
    await owner
      .getByRole("button", { name: "Call", exact: true })
      .first()
      .click()
    await expect(
      owner.getByRole("button", { name: "Request permission", exact: true })
    ).toBeEnabled()
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/softphone-permission.png`,
      fullPage: true,
    })
    await owner
      .getByRole("button", { name: "Request permission", exact: true })
      .click()
    await expect(
      owner.getByText("Calling permission requested", { exact: true })
    ).toBeVisible()
    const graph = await (
      await owner.request.get(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`)
    ).json()
    expect(graph).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `/${PHONE_ID}/call_permissions`,
          query: { recipient: BSUID },
        }),
      ])
    )
  })
}
