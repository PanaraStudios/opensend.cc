import { connectWhatsApp, WABA, PHONE_ID } from "./meta-fixtures"
import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import type { Doc } from "../../convex/_generated/dataModel"
import { createApiKey } from "./broadcast-received-flow"
import {
  backendRows,
  receivedFixture,
  seedReceivedMessage,
  testBackendValue,
} from "./ses-fixtures"

/** The connected WhatsApp number (meta-fixtures.ts), the app secret
    metaAppTests saved, and a customer no earlier flow wrote from. */
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const CUSTOMER = "16505557777"
const NAME = "Inbox Flow Customer"
/** Approved by whatsappTemplatesTests. */
const TEMPLATE = "e2e_order_update"

type GraphCall = { method: string; path: string; body?: unknown }
const fakeGraph = () => process.env.OPENSEND_FAKE_GRAPH_URL!

const shots = async (page: Page, name: string) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/inbox-${name}-${theme}.png`,
      fullPage: true,
    })
  }
  await page.emulateMedia({ colorScheme: "light" })
}

/** A signed Meta webhook for the connected WABA. */
async function webhook(page: Page, value: Record<string, unknown>) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                phone_number_id: PHONE_ID,
                display_phone_number: "+1 555-0001",
              },
              ...value,
            },
          },
        ],
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
const now = () => String(Math.floor(Date.now() / 1000))
const inbound = (page: Page, id: string, text: string) =>
  webhook(page, {
    contacts: [{ wa_id: CUSTOMER, profile: { name: NAME } }],
    messages: [
      {
        from: CUSTOMER,
        id,
        timestamp: now(),
        type: "text",
        text: { body: text },
      },
    ],
  })
const status = (page: Page, id: string, value: string) =>
  webhook(page, {
    statuses: [{ id, status: value, recipient_id: CUSTOMER, timestamp: now() }],
  })
async function controls(page: Page) {
  const calls: GraphCall[] = await (
    await page.request.get(`${fakeGraph()}/__calls`)
  ).json()
  return calls.filter(
    (call) => call.method === "POST" && call.path === `/${PHONE_ID}/messages`
  )
}
async function sends(page: Page) {
  return (await controls(page)).filter(
    (call) => !(call.body as { status?: string })?.status
  )
}
async function filterChannel(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Filter by channel" }).click()
  await page.getByRole("option", { name: label, exact: true }).click()
}

/** Runs after whatsappTemplatesTests, whose approved template it sends. */
export function inboxTests(
  state: () => { owner: Page; organizationId: string; sendingDomainId: string }
) {
  test("the Playground inbox threads WhatsApp and email, replies in and out of the window, and the logs filter by channel", async () => {
    const { owner, organizationId, sendingDomainId } = state()
    await connectWhatsApp(owner, organizationId)
    await owner.request.post(`${fakeGraph()}/__reset`)

    // Playground hosts manual testing; Messages keeps the delivery logs.
    await owner.goto("/playground")
    await expect(owner).toHaveURL(/\/playground\/inbox$/)
    await expect(
      owner.getByRole("link", { name: "Messages", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("heading", { name: "Playground", exact: true })
    ).toBeVisible()
    for (const tab of ["Inbox", "Calls", "IVR", "Voice bot"])
      await expect(
        owner.getByRole("tab", { name: tab, exact: true })
      ).toBeVisible()

    await expect(
      owner.getByRole("tab", { name: "Sending", exact: true })
    ).toHaveCount(0)
    await expect(owner.locator('[aria-label="Softphone"]')).toHaveCount(0)

    for (const [tab, route, title] of [
      ["IVR", "ivr", "Create IVR"],
      ["Voice bot", "voice-bot", "Create voice bot"],
    ]) {
      await owner.getByRole("tab", { name: tab, exact: true }).click()
      await expect(owner).toHaveURL(new RegExp(`/playground/${route}$`))
      await expect(
        owner.getByRole("link", { name: title }).or(owner.getByRole("button", { name: title })).first()
      ).toBeVisible()
    }
    await owner.getByRole("tab", { name: "Inbox", exact: true }).click()
    await shots(owner, "playground")

    // A signed inbound message shows up live, unread.
    await inbound(owner, "wamid.inbox-e2e-1", "Is my order ready?")
    const row = owner.getByTestId("conversation").filter({ hasText: NAME })
    await expect(row).toContainText("Is my order ready?")
    await expect(row.getByLabel("Unread", { exact: true })).toHaveText("1")
    await shots(owner, "unread")

    // Opening it reads it.
    await row.click()
    await expect(owner).toHaveURL(/\/playground\/inbox\?c=/)
    const conversationId = new URL(owner.url()).searchParams.get("c")!
    await owner.goto(`/emails/inbox?c=${conversationId}`)
    await expect(owner).toHaveURL(
      new RegExp(`/playground/inbox\\?c=${conversationId}$`)
    )
    await expect(row.getByLabel("Unread", { exact: true })).toHaveCount(0)
    await expect(owner.getByText("Is my order ready?").last()).toBeVisible()
    // The reply composer stays a single row; buttons share the input group.
    const replyGroup = owner
      .getByTestId("conversation-thread")
      .locator('[data-slot="input-group"]')
      .filter({ has: owner.getByLabel("Reply", { exact: true }) })
    await expect(replyGroup).toHaveCount(1)
    await expect(replyGroup.locator('[data-align="block-end"]')).toHaveCount(0)
    await expect(
      replyGroup
        .locator('[data-align="inline-start"]')
        .getByRole("button", { name: "More message options" })
    ).toBeVisible()
    await expect(
      replyGroup
        .locator('[data-align="inline-end"]')
        .getByRole("button", { name: "Send", exact: true })
    ).toBeVisible()
    await expect(
      owner
        .getByTestId("thread-message")
        .filter({ hasText: "Is my order ready?" })
        .locator('[data-slot="bubble"]')
    ).toHaveAttribute("data-variant", "muted")

    await expect
      .poll(async () => (await controls(owner)).map((call) => call.body))
      .toContainEqual({
        messaging_product: "whatsapp",
        status: "read",
        message_id: "wamid.inbox-e2e-1",
      })
    await shots(owner, "read-receipt")

    // A reply goes to Graph and its ticks follow the status webhooks.
    await owner.getByLabel("Reply", { exact: true }).fill("On its way!")
    await owner.getByRole("button", { name: "Send", exact: true }).click()
    const bubble = owner
      .getByTestId("thread-message")
      .filter({ hasText: "On its way!" })
    await expect(bubble.getByTestId("message-status")).toHaveText("Sent", {
      timeout: 45_000,
    })
    expect((await sends(owner)).map((call) => call.body)).toEqual([
      expect.objectContaining({
        to: CUSTOMER,
        type: "text",
        text: expect.objectContaining({ body: "On its way!" }),
      }),
    ])
    const reply = backendRows<Doc<"channelMessages">>("channelMessages").find(
      (message) => message.preview === "On its way!"
    )!
    for (const [value, label] of [
      ["delivered", "Delivered"],
      ["read", "Read"],
    ] as const) {
      await status(owner, reply.externalId!, value)
      await expect(bubble.getByTestId("message-status")).toHaveText(label)
    }
    await shots(owner, "thread")
    await expect(bubble.locator('[data-slot="bubble"]')).toHaveAttribute(
      "data-variant",
      "default"
    )
    await expect(bubble.getByTestId("message-status")).toHaveClass(/text-info/)

    // Once the window closes, only an approved template can be sent.
    testBackendValue("meta/fixtures:expireWindow", { conversationId })
    await expect(
      owner.getByText("The 24-hour window is closed.", { exact: true })
    ).toBeVisible()
    await expect(owner.getByLabel("Reply", { exact: true })).toHaveCount(0)
    await owner.locator("#reply-template").click()
    await owner
      .getByRole("option", { name: new RegExp(`^${TEMPLATE}`) })
      .click()
    await owner.getByLabel("Variable {{1}}", { exact: true }).fill("Pablo")
    await shots(owner, "template")
    await owner
      .getByRole("button", { name: "Send template", exact: true })
      .click()
    await expect(
      owner
        .getByTestId("thread-message")
        .filter({ hasText: "Hi Pablo, your order is ready." })
        .getByTestId("message-status")
    ).toHaveText("Sent", { timeout: 45_000 })
    const templateBubble = owner
      .getByTestId("thread-message")
      .filter({ hasText: "Hi Pablo, your order is ready." })
    await expect(templateBubble.getByTestId("whatsapp-preview")).toContainText(
      "Hi Pablo, your order is ready."
    )
    await expect(row).toContainText("Hi Pablo, your order is ready.")
    await expect(row).not.toContainText("[template:")
    // The shared view occupies the existing bubble, with no nested card.
    await expect(templateBubble.locator('[data-slot="bubble"]')).toHaveCount(1)
    await shots(owner, "template-sent")
    const templateMessage = backendRows<Doc<"channelMessages">>(
      "channelMessages"
    ).find(
      (message) =>
        message.conversationId === conversationId && message.type === "template"
    )!
    await owner.goto(`/emails/messages/${templateMessage._id}`)
    await expect(owner.getByTestId("whatsapp-preview")).toContainText(
      "Hi Pablo, your order is ready."
    )
    await shots(owner, "template-detail")
    expect((await sends(owner)).at(-1)?.body).toMatchObject({
      to: CUSTOMER,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Pablo" }] },
        ],
      },
    })

    // Received email is a thread of its sender's.
    const headers = await createApiKey(owner, "Inbox E2E")
    await seedReceivedMessage(
      owner,
      organizationId,
      sendingDomainId,
      headers,
      "inbox-flow"
    )
    await owner.goto("/playground/inbox")
    await filterChannel(owner, "Email")
    const email = owner
      .getByTestId("conversation")
      .filter({ hasText: receivedFixture.subject })
    await email.click()
    await expect(owner.getByText("sender@example.test").first()).toBeVisible()
    await expect(
      owner
        .getByTestId("thread-message")
        .filter({ hasText: receivedFixture.text })
        .first()
    ).toBeVisible()
    await expect(owner.getByLabel("From", { exact: true })).toBeVisible()
    await shots(owner, "email")

    // Sending, filtered to WhatsApp, lists the reply; its page has the timeline.
    await owner.goto("/emails")
    for (const tab of ["Sending", "Receiving", "Suppressions"])
      await expect(
        owner.getByRole("tab", { name: tab, exact: true })
      ).toBeVisible()
    for (const tab of ["Inbox", "Calls"])
      await expect(
        owner.getByRole("tab", { name: tab, exact: true })
      ).toHaveCount(0)
    await filterChannel(owner, "WhatsApp")
    const logged = owner.getByRole("row").filter({ hasText: "On its way!" })
    await expect(logged).toContainText("Read")
    await shots(owner, "sending")
    await logged.getByRole("link", { name: `+${CUSTOMER}` }).click()
    await expect(owner).toHaveURL(/\/emails\/messages\/[^/]+$/)
    await expect(
      owner.getByRole("heading", { name: `+${CUSTOMER}`, exact: true })
    ).toBeVisible()
    for (const step of ["Queued", "Sent", "Delivered", "Read"])
      await expect(owner.getByText(step, { exact: true }).last()).toBeVisible()
    await expect(owner.getByText("Payload", { exact: true })).toBeVisible()
    const detailThread = owner.getByTestId("conversation-thread")
    await expect(detailThread).toBeVisible()
    await expect(
      detailThread.getByText("The 24-hour window is closed.", { exact: true })
    ).toBeVisible()
    await inbound(owner, "wamid.detail-reply", "Please confirm delivery")
    await expect(
      detailThread.getByLabel("Reply", { exact: true })
    ).toBeVisible()
    await expect(
      detailThread
        .getByTestId("thread-message")
        .filter({ hasText: "Is my order ready?" })
    ).toBeVisible()
    await detailThread
      .getByLabel("Reply", { exact: true })
      .fill("Reply from message detail")
    await detailThread
      .getByRole("button", { name: "Send", exact: true })
      .click()
    await expect(
      detailThread
        .getByTestId("thread-message")
        .filter({ hasText: "Reply from message detail" })
    ).toBeVisible()
    await expect
      .poll(async () => (await sends(owner)).at(-1)?.body)
      .toMatchObject({
        type: "text",
        text: { body: "Reply from message detail" },
      })
    await shots(owner, "detail")
    // Reusable conversation module: independent scroll and interactive sends.
    await inbound(
      owner,
      "wamid.inbox-rich",
      "*Ready* _to ship_ https://example.test/order"
    )
    await owner.goto(`/playground/inbox?c=${conversationId}`)
    const threadPanel = owner.getByTestId("conversation-thread")
    await expect(
      threadPanel.locator("strong").filter({ hasText: "Ready" })
    ).toBeVisible()
    const geometry = await owner
      .getByTestId("inbox-layout")
      .evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        viewport: window.innerHeight,
      }))
    expect(geometry.height).toBeLessThan(geometry.viewport)
    await owner
      .getByRole("button", { name: "More message options", exact: true })
      .click()
    await owner
      .getByRole("button", { name: "Interactive message", exact: true })
      .click()
    const interactive = owner.getByRole("dialog", {
      name: "Send interactive message",
      exact: true,
    })
    await interactive
      .getByLabel("Message", { exact: true })
      .fill("Choose a delivery time")
    await interactive.getByLabel("Option 1", { exact: true }).fill("Morning")
    await interactive
      .getByRole("button", { name: "Send interactive message", exact: true })
      .click()
    await expect(interactive).toBeHidden()
    await expect(
      owner
        .getByTestId("thread-message")
        .filter({ hasText: "Choose a delivery time" })
    ).toContainText("Morning")
    await shots(owner, "interactive")
    // Send message from contact detail and Playground opens the same thread.
    const threadRow = backendRows<Doc<"conversations">>("conversations").find(
      (item) => item._id === conversationId
    )!
    await owner.goto(`/contacts/${threadRow.contactId}`)
    await owner
      .getByRole("button", { name: "Send message", exact: true })
      .click()
    const start = owner.getByRole("dialog", {
      name: "Send message",
      exact: true,
    })
    await start.locator("#send-account").click()
    await owner.getByRole("option", { name: /Opensend E2E/ }).click()
    await start
      .getByRole("button", { name: "Continue to conversation", exact: true })
      .click()
    await expect
      .poll(() => new URL(owner.url()).searchParams.get("c"))
      .toBe(conversationId)
    await expect(owner).toHaveURL(
      new RegExp(`/playground/inbox\\?c=${conversationId}$`)
    )
    await owner
      .getByRole("button", { name: "Send message", exact: true })
      .click()
    await expect(
      start.getByRole("combobox", { name: "Contact", exact: true })
    ).toBeVisible()
    await start.getByRole("button", { name: "Close", exact: true }).click()
    await shots(owner, "start-conversation")
    await owner.request.post(`${fakeGraph()}/__reset`)
  })
}
