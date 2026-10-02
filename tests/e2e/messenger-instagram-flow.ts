import type { PageChannel } from "../../lib/channels"
import { createHmac } from "node:crypto"
import { expect, test, type Page, type APIResponse } from "@playwright/test"
import type { Id } from "../../convex/_generated/dataModel"
import { choose } from "./whatsapp-campaigns-flow"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"
import { createApiKey } from "./broadcast-received-flow"
const PAGE_ID = "555000100",
  IG_ID = "178414000001",
  PSID = "10000001",
  IGSID = "20000001"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const origin = () => process.env.OPENSEND_CALLBACK_ORIGIN!
const fake = () => process.env.OPENSEND_FAKE_GRAPH_URL!
async function webhook(
  page: Page,
  channel: PageChannel,
  data: Record<string, unknown>
) {
  const id = channel === "messenger" ? PAGE_ID : IG_ID
  const body = JSON.stringify({
    object: channel === "messenger" ? "page" : "instagram",
    entry: [
      {
        id,
        messaging: [
          {
            sender: { id: channel === "messenger" ? PSID : IGSID },
            recipient: { id },
            timestamp: Date.now(),
            ...data,
          },
        ],
      },
    ],
  })
  const response = await page.request.post(`${origin()}/meta/webhook`, {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
    },
  })
  expect(response.status()).toBe(200)
}
export function messengerInstagramTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("Page connection receives Messenger/Instagram, replies through REST and a UI automation, records customer webhooks and displays channel icons", async () => {
    const { owner, organizationId } = state(),
      backend = await client(owner)
    const connected = await backend.action(
      api.meta.pageConnectActions.connectPageManual,
      {
        organizationId,
        pageId: PAGE_ID,
        token: "EAAPageE2EToken0123456789abcdef",
      }
    )
    expect(connected.accounts.map((a) => a.channel)).toEqual([
      "messenger",
      "instagram",
    ])
    const headers = await createApiKey(owner, "Messenger Instagram E2E")
    const customerWebhook = await backend.action(api.webhooks.create, {
      organizationId,
      endpoint: "https://page-messages.invalid/events",
      events: ["messenger.message.received"],
    })
    const rest = async (request: () => Promise<APIResponse>) => {
      for (let retry = 0; ; retry++) {
        const response = await request()
        if (response.status() !== 429 || retry >= 3) return response
        await owner.waitForTimeout(
          Math.max(1000, Number(response.headers()["retry-after"] ?? 1) * 1000)
        )
      }
    }
    const get = async (path: string) => {
      const response = await rest(() =>
        owner.request.get(`${origin()}${path}`, { headers })
      )
      expect(response.status()).toBe(200)
      return response.json()
    }
    let automationId: Id<"automations"> | undefined
    try {
      await owner.request.post(`${fake()}/__reset`)
      for (const channel of ["messenger", "instagram"] as const) {
        const to = channel === "messenger" ? PSID : IGSID
        await webhook(owner, channel, {
          message: {
            mid: `mid.e2e.${channel}`,
            text: `${channel} inbound E2E`,
          },
        })
        await expect
          .poll(async () =>
            (await get(`/${channel}/messages`)).data.some(
              (m: { external_id: string }) =>
                m.external_id === `mid.e2e.${channel}`
            )
          )
          .toBe(true)
        const inbound = (await get(`/${channel}/messages`)).data.find(
          (m: { external_id: string }) => m.external_id === `mid.e2e.${channel}`
        )
        const conversations = await get(`/${channel}/conversations`)
        const conversation = conversations.data.find(
          (c: { id: string }) => c.id === inbound.conversation_id
        )
        expect(conversation.contact_id).toBeTruthy()
        expect(Date.parse(conversation.window_expires_at)).toBeGreaterThan(
          Date.now()
        )
        const request = {
          to,
          text: `${channel} reply E2E`,
          reply_to: inbound.id,
        }
        const sent = await rest(() =>
          owner.request.post(`${origin()}/${channel}/messages`, {
            headers: { ...headers, "Idempotency-Key": `e2e-${channel}` },
            data: request,
          })
        )
        expect(sent.status()).toBe(200)
        const { id } = await sent.json()
        const replay = await rest(() =>
          owner.request.post(`${origin()}/${channel}/messages`, {
            headers: { ...headers, "Idempotency-Key": `e2e-${channel}` },
            data: request,
          })
        )
        expect(await replay.json()).toEqual({ id })
        await expect
          .poll(async () => (await get(`/${channel}/messages/${id}`)).status, {
            timeout: 45000,
          })
          .toBe("sent")
        const message = await get(`/${channel}/messages/${id}`)
        if (channel === "messenger") {
          await webhook(owner, channel, {
            delivery: { mids: [message.external_id], watermark: Date.now() },
          })
          await expect
            .poll(async () => (await get(`/${channel}/messages/${id}`)).status)
            .toBe("delivered")
        }
        await webhook(owner, channel, {
          read:
            channel === "messenger"
              ? { watermark: Date.now() }
              : { mid: message.external_id },
        })
        await expect
          .poll(async () => (await get(`/${channel}/messages/${id}`)).status)
          .toBe("read")
        const calls = await (
          await owner.request.get(`${fake()}/__calls`)
        ).json()
        expect(
          calls.filter(
            (c: { path: string; body?: { recipient?: { id: string } } }) =>
              c.path === `/${PAGE_ID}/messages` && c.body?.recipient?.id === to
          )
        ).toHaveLength(1)
        expect(calls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: `/${PAGE_ID}/messages`,
              authorization: "Bearer EAAPageE2EToken0123456789abcdef",
              body: expect.objectContaining({
                recipient: { id: to },
                messaging_type: "RESPONSE",
                message: { text: request.text },
                reply_to: { mid: inbound.external_id },
              }),
            }),
          ])
        )
      }
      // Build the reply in the dashboard, then drive it through the real webhook and Graph send path.
      await owner.goto("/automations")
      await owner
        .getByRole("button", { name: "Create automation", exact: true })
        .click()
      await owner.waitForURL(/\/automations\/[^/]+$/)
      automationId = new URL(owner.url()).pathname.split(
        "/"
      )[2] as Id<"automations">
      await owner.getByTestId("workflow-node-start").click()
      await owner.getByPlaceholder("Type or select an event").click()
      await owner
        .getByRole("option", {
          name: "Messenger message received",
          exact: true,
        })
        .click()
      await owner.getByTestId("workflow-add-step").last().click()
      await owner
        .getByRole("menuitem", { name: "Send Messenger message", exact: true })
        .click()
      const messengerAccount = connected.accounts.find(
        (account) => account.channel === "messenger"
      )!
      const accountDetail = await backend.query(api.meta.connect.getAccount, {
        id: messengerAccount.id,
      })
      const account = accountDetail!.account
      await choose(
        owner,
        "Sending page",
        `${account.displayName} (${account.handle})`
      )
      await choose(owner, "Message type", "Text")
      const reply = "Messenger automated reply E2E"
      await owner.getByLabel("Messenger message", { exact: true }).fill(reply)
      const id = automationId
      await expect
        .poll(
          async () =>
            (await backend.query(api.automations.get, { organizationId, id }))
              ?.graph
        )
        .toContain(reply)
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/messenger-instagram-automation-builder.png`,
        fullPage: true,
      })
      await owner.getByTestId("automation-toggle").click()
      await expect(owner.getByTestId("automation-toggle")).toContainText("Stop")
      await webhook(owner, "messenger", {
        message: {
          mid: "mid.e2e.messenger.automation",
          text: "Please reply automatically",
        },
      })
      await expect
        .poll(
          async () => {
            const calls = await (
              await owner.request.get(`${fake()}/__calls`)
            ).json()
            return calls.filter(
              (call: { path: string; body?: { message?: { text: string } } }) =>
                call.path === `/${PAGE_ID}/messages` &&
                call.body?.message?.text === reply
            ).length
          },
          { timeout: 45000 }
        )
        .toBe(1)
      const calls = await (await owner.request.get(`${fake()}/__calls`)).json()
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `/${PAGE_ID}/messages`,
            body: {
              recipient: { id: PSID },
              messaging_type: "RESPONSE",
              message: { text: reply },
            },
          }),
        ])
      )
      await expect
        .poll(
          async () =>
            (
              await backend.query(api.automations.runs, {
                organizationId,
                id,
                paginationOpts: { cursor: null, numItems: 10 },
              })
            ).page.some((run) => run.status === "completed" && run.sent === 1),
          { timeout: 45000 }
        )
        .toBe(true)
      await owner.getByTestId("view-toggle-observability").click()
      await expect(
        owner.getByText("Completed", { exact: true }).first()
      ).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/messenger-instagram-automation-runs.png`,
        fullPage: true,
      })
      await backend.mutation(api.automations.setStatus, {
        organizationId,
        id,
        status: "disabled",
      })
      const closed = await rest(() =>
        owner.request.post(`${origin()}/messenger/messages`, {
          headers,
          data: { to: "999000001", text: "Window closed" },
        })
      )
      expect(closed.status()).toBe(422)
      expect((await closed.json()).message).toContain(
        "24-hour messaging window is closed"
      )
      await expect
        .poll(
          async () =>
            (
              await backend.query(api.webhooks.deliveries, {
                webhookId: customerWebhook,
                event: "messenger.message.received",
                paginationOpts: { cursor: null, numItems: 10 },
              })
            ).page.length
        )
        .toBeGreaterThan(0)
      await owner.goto("/contacts")
      const contactRow = owner
        .getByRole("row")
        .filter({ hasText: "Ada" })
        .filter({ hasText: "E2E" })
      await expect(contactRow).toBeVisible()
      const identityLink = contactRow.getByRole("link", { name: /Ada E2E/ })
      await expect(identityLink).toHaveAttribute("href", /^\/contacts\//)
      await expect(contactRow).not.toContainText(PSID)
      const instagramContact = owner
        .getByRole("row")
        .filter({ hasText: "Grace E2E" })
      await expect(instagramContact).toBeVisible()
      await expect(instagramContact).toContainText("@grace_e2e")
      await expect(instagramContact).not.toContainText(IGSID)
      expect(
        await (await owner.request.get(`${fake()}/__calls`)).json()
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `/${IGSID}`,
            query: expect.objectContaining({
              fields: "name,username,profile_pic",
            }),
          }),
          expect.objectContaining({
            path: `/${PSID}`,
            query: expect.objectContaining({ fields: "first_name,last_name" }),
          }),
        ])
      )
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/messenger-instagram-contact-identity.png`,
        fullPage: true,
      })
      await identityLink.click()
      await expect(
        owner.getByRole("heading", { name: "Ada E2E", exact: true })
      ).toBeVisible()
      const messengerIdentity = owner.getByRole("region", {
        name: "Contact channels",
      })
      await expect(
        messengerIdentity.getByRole("row").filter({ hasText: "Messenger" })
      ).toContainText(PSID)
      await owner.goto("/contacts")
      await owner
        .getByRole("row")
        .filter({ hasText: "Grace E2E" })
        .getByRole("link", { name: /Grace E2E/ })
        .click()
      const instagramIdentity = owner.getByRole("region", {
        name: "Contact channels",
      })
      await expect(instagramIdentity).toContainText("@grace_e2e")
      await expect(instagramIdentity).toContainText("Opensend")
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/messenger-instagram-contact-channels.png`,
        fullPage: true,
      })
      await owner.goto("/channels")
      // The Instagram row names the same Page as its business.
      const messenger = owner
        .getByRole("row")
        .filter({ hasText: "Opensend Messenger E2E" })
        .filter({ hasNotText: "opensend_ig_e2e" })
      const instagram = owner
        .getByRole("row")
        .filter({ hasText: "opensend_ig_e2e" })
      await expect(messenger).toBeVisible()
      await expect(instagram).toBeVisible()
      // Lane 5B supplies the existing brand icons on these shared rows.
      await expect(messenger.locator("svg path").first()).toHaveAttribute(
        "d",
        /^M12 0/
      )
      await expect(instagram.locator("svg path").first()).toHaveAttribute(
        "d",
        /^M7/
      )
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/messenger-instagram-channels.png`,
        fullPage: true,
      })
    } finally {
      if (automationId)
        await backend.mutation(api.automations.remove, {
          organizationId,
          id: automationId,
        })
      await backend.mutation(api.webhooks.remove, { id: customerWebhook })
    }
  })
}
