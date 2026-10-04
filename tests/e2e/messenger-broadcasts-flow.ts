import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import { client, backendRows } from "./ses-fixtures"
const PAGE_ID = "555000100"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const origin = () => process.env.OPENSEND_CALLBACK_ORIGIN!
async function webhook(page: Page, messaging: Record<string, unknown>) {
  const body = JSON.stringify({
    object: "page",
    entry: [
      {
        id: PAGE_ID,
        messaging: [
          { recipient: { id: PAGE_ID }, timestamp: Date.now(), ...messaging },
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
/** Registered in the serial authenticated suite; uses the existing fake Graph. */
export function messengerBroadcastTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("Messenger broadcast reaches the open window and reports the closed window as skipped", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    const connected = await backend.action(
      api.meta.pageConnectActions.connectPageManual,
      {
        organizationId,
        pageId: PAGE_ID,
        token: "EAAPageE2EToken0123456789abcdef",
      }
    )
    const accountId = connected.accounts.find(
      (a) => a.channel === "messenger"
    )!.id
    const people = ["10000021", "10000022"]
    for (const [index, psid] of people.entries())
      await webhook(owner, {
        sender: { id: psid },
        timestamp: Date.now() - index * 25 * 3600_000,
        message: {
          mid: `mid.broadcast.${psid}`,
          text: "Please keep me updated",
        },
      })
    await expect
      .poll(
        () =>
          backendRows<Doc<"conversations">>("conversations").filter(
            (c) =>
              c.organizationId === organizationId &&
              c.accountId === accountId &&
              backendRows<Doc<"channelContacts">>("channelContacts").some(
                (i) =>
                  i._id === c.channelContactId && people.includes(i.externalId)
              )
          ).length
      )
      .toBe(2)
    const identities = backendRows<Doc<"channelContacts">>(
      "channelContacts"
    ).filter(
      (i) =>
        i.organizationId === organizationId &&
        i.scopeId === PAGE_ID &&
        people.includes(i.externalId)
    )
    const segmentId = await backend.mutation(api.segments.create, {
      organizationId,
      name: "Messenger broadcast audience",
    })
    await backend.mutation(api.contacts.addToSegments, {
      organizationId,
      ids: identities.map((i) => i.contactId!),
      segmentIds: [segmentId],
    })
    const templateId = await backend.mutation(api.templates.create, {
      organizationId,
      channel: "messenger",
      name: "Messenger broadcast update",
      content: { text: "Hello {{{name}}}" },
    })
    await backend.mutation(api.templates.publish, { id: templateId })
    const broadcastId = await backend.mutation(api.broadcasts.create, {
      organizationId,
      channel: "messenger",
      name: "Messenger windows",
      segmentId,
      messaging: {
        accountId,
        templateId,
        variables: { name: { contact: "firstName", fallback: "friend" } },
      },
    })
    await owner.setViewportSize({ width: 390, height: 844 })
    await owner.goto(`/broadcasts/${broadcastId}/edit`)
    await owner.getByTestId("messenger-broadcast-review").click()
    await expect(
      owner.getByTestId("messenger-broadcast-estimate")
    ).toContainText("1 of 2 can be reached now")
    await expect(
      owner.getByTestId("messenger-broadcast-estimate")
    ).toContainText("The others can’t be messaged until they write again.")
    await owner
      .getByRole("button", { name: "Send broadcast", exact: true })
      .click()
    const scope = { organizationId, id: broadcastId as Id<"broadcasts"> }
    const recipients = () =>
      backend.query(api.broadcastWhatsApp.recipients, {
        ...scope,
        paginationOpts: { cursor: null, numItems: 50 },
      })
    await expect
      .poll(
        async () =>
          (await recipients()).page.filter((r) => r.messageStatus === "sent")
            .length,
        { timeout: 45000 }
      )
      .toBe(1)
    const sent = (await recipients()).page.find((r) => r.messageId)!
    const message = backendRows<Doc<"channelMessages">>("channelMessages").find(
      (m) => m._id === sent.messageId
    )!
    await webhook(owner, {
      sender: { id: people[0] },
      delivery: { mids: [message.externalId], watermark: Date.now() },
    })
    await expect
      .poll(
        async () =>
          (await recipients()).page.filter(
            (r) => r.messageStatus === "delivered"
          ).length
      )
      .toBe(1)
    await expect(owner.getByTestId("messenger-stat-delivered")).toContainText(
      "1"
    )
    await expect(owner.getByTestId("messenger-stat-skipped")).toContainText("1")
    await expect(
      owner.getByText("Messaging window closed", { exact: true })
    ).toBeVisible()
    const calls = (await (
      await owner.request.get(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`)
    ).json()) as {
      method: string
      path: string
      body: { recipient?: { id: string }; tag?: string }
    }[]
    const sends = calls.filter(
      (c) =>
        c.method === "POST" &&
        c.path === `/${PAGE_ID}/messages` &&
        people.includes(c.body.recipient?.id ?? "")
    )
    expect(sends).toHaveLength(1)
    expect(sends[0].body).not.toHaveProperty("tag")
    await owner.setViewportSize({ width: 1280, height: 900 })
  })
}
