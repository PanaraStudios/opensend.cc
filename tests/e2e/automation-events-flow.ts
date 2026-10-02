import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import { backendRows, client } from "./ses-fixtures"
import { WABA, PHONE_ID } from "./meta-fixtures"

const APP_SECRET = "e2e0123456789abcdef0123456789abc"
export function automationEventsTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("catalog trigger filters reply to a signed price enquiry with trigger and contact references", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    const account = backendRows<Doc<"channelAccounts">>("channelAccounts").find(
      (row) =>
        row.organizationId === organizationId && row.externalId === PHONE_ID
    )!
    expect(account).toBeTruthy()
    await backend.mutation(api.contacts.upsert, {
      organizationId,
      segmentIds: [],
      contacts: [{ phone: "+15550008061", firstName: "Ada" }],
    })
    const id = await backend.mutation(api.automations.create, {
      organizationId,
    })
    await backend.mutation(api.automations.update, {
      organizationId,
      id,
      trigger: "opensend:whatsapp.message.received",
      triggerFilters: [
        { field: "trigger.message.text", operator: "contains", value: "price" },
      ],
      graph: JSON.stringify([
        {
          key: "reply",
          type: "send_whatsapp",
          accountId: account._id,
          mode: "text",
          variables: {},
          text: "Hi {{contact.first_name}}, you asked: {{trigger.message.text}}",
        },
      ]),
    })
    const originalTheme = await owner.evaluate(() =>
      localStorage.getItem("theme")
    )
    for (const theme of ["light", "dark"] as const) {
      await owner.evaluate(
        (value) => localStorage.setItem("theme", value),
        theme
      )
      await owner.goto(`/automations/${id}`)
      await owner
        .getByTestId("workflow-node-start")
        .getByRole("button", { name: "WhatsApp message received", exact: true })
        .click()
      await owner
        .getByRole("combobox", { name: "Event picker", exact: true })
        .click()
      await expect(owner.getByPlaceholder("Search events…")).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/automation-events-trigger-picker-${theme}.png`,
        fullPage: true,
      })
      await owner.keyboard.press("Escape")
      await owner
        .getByTestId("workflow-node-reply")
        .getByRole("button", { name: "Send WhatsApp", exact: true })
        .click()
      await expect(
        owner.getByLabel("WhatsApp message", { exact: true })
      ).toHaveValue("Hi ")
      const message = owner.getByRole("group", {
        name: "WhatsApp message field",
        exact: true,
      })
      await expect(message).toContainText("Contact › First name")
      await expect(message).toContainText("Trigger › Message › Text")
      await owner
        .getByTestId("workflow-node-reply")
        .getByRole("combobox", { name: "Insert variable", exact: true })
        .click()
      await expect(owner.getByPlaceholder("Search variables…")).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/automation-events-variable-picker-${theme}.png`,
        fullPage: true,
      })
      await owner.keyboard.press("Escape")
    }
    await owner.getByTestId("automation-toggle").click()
    await expect(owner.getByTestId("automation-toggle")).toHaveText("Stop")
    const emit = async (text: string, suffix: string) => {
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
                    { wa_id: "15550008061", profile: { name: "Ada" } },
                  ],
                  messages: [
                    {
                      id: `wamid.automation-events-${suffix}`,
                      from: "15550008061",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: text },
                    },
                  ],
                },
              },
            ],
          },
        ],
      })
      const response = await owner.request.post(
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
    await owner.request.post(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__reset`)
    await emit("what is the price?", "price")
    const calls = async () =>
      (
        (await (
          await owner.request.get(
            `${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`
          )
        ).json()) as {
          method: string
          path: string
          body?: { to?: string; text?: { body?: string } }
        }[]
      ).filter(
        (call) =>
          call.method === "POST" &&
          call.path === `/${PHONE_ID}/messages` &&
          call.body?.to === "15550008061"
      )
    await expect
      .poll(async () => (await calls()).map((call) => call.body?.text?.body), {
        timeout: 30000,
      })
      .toEqual(["Hi Ada, you asked: what is the price?"])
    await emit("hello", "ignored")
    for (const theme of ["light", "dark"] as const) {
      await owner.evaluate(
        (value) => localStorage.setItem("theme", value),
        theme
      )
      await owner.goto(`/automations/${id}`)
      await owner.getByTestId("view-toggle-observability").click()
      await owner.getByTestId("run-row").first().click()
      await expect(owner.getByTestId("workflow")).toContainText(
        "Resolved inputs"
      )
      await expect(owner.getByTestId("workflow")).toContainText('"message_id"')
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/automation-events-run-detail-${theme}.png`,
        fullPage: true,
      })
    }
    expect(await calls()).toHaveLength(1)
    const runs = backendRows<Doc<"automationRuns">>("automationRuns").filter(
      (row) => row.automationId === id
    )
    expect(runs).toHaveLength(1)
    await backend.mutation(api.automations.setStatus, {
      organizationId,
      id: id as Id<"automations">,
      status: "disabled",
    })
    await owner.evaluate(
      (value) =>
        value === null
          ? localStorage.removeItem("theme")
          : localStorage.setItem("theme", value),
      originalTheme
    )
  })
}
