import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import {
  client,
  receivedFixture,
  seedBroadcastSender,
  seedReceivedMessage,
  testBackend,
  testBackendValue,
} from "./ses-fixtures"

const sender = "Opensend <hello@onboarding.example.test>"
const paginationOpts = { cursor: null, numItems: 50 }
const httpOrigin = () => process.env.OPENSEND_CALLBACK_ORIGIN!
const toast = (page: Page) => page.locator('[data-slot="toast-viewport"]')

async function createApiKey(page: Page, name: string) {
  await page.goto("/api-keys")
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .first()
    .click()
  const form = page.getByRole("dialog", { name: "Add API Key", exact: true })
  await form.getByLabel("Name", { exact: true }).fill(name)
  await form.getByRole("button", { name: "Add", exact: true }).click()
  const reveal = page.getByRole("dialog", { name: "View API Key", exact: true })
  await reveal
    .getByRole("button", { name: "Show API key", exact: true })
    .click()
  const token = await reveal.getByLabel("API key", { exact: true }).inputValue()
  expect(token).toMatch(/^os_/)
  await reveal.getByRole("button", { name: "Done", exact: true }).click()
  await expect(reveal).toBeHidden()
  return { Authorization: `Bearer ${token}` }
}

async function createDraft(page: Page, name: string) {
  await page.goto("/broadcasts")
  await page
    .getByRole("button", { name: "Create broadcast", exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/\/broadcasts\/[^/]+\/edit$/)
  const id = new URL(page.url()).pathname.split("/")[2] as Id<"broadcasts">
  await page.getByTestId("editor-name").fill(name)
  await page.getByTestId("editor-name").press("Tab")
  return id
}

type State = {
  owner: Page
  organizationId: string
  sendingDomainId: Id<"domains">
  ownerEmail: string
}

/** A ConvexError's text travels in `data`; its message is only "Server Error". */
async function refused(request: Promise<unknown>, pattern: RegExp) {
  const error = await request.then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(Error)
  const { message, data } = error as Error & { data?: unknown }
  expect(`${message} ${typeof data === "string" ? data : ""}`).toMatch(pattern)
}

/** Register inside auth.spec's serial describe, once its owner/team/domain exist. */
export function broadcastReceivedTests(state: () => State) {
  test("persists a visual broadcast, reviews, tests, schedules, cancels and settles recipient failures", async () => {
    test.setTimeout(120_000)
    const { owner, organizationId, sendingDomainId, ownerEmail } = state()
    const backend = await client(owner)
    await seedBroadcastSender(owner, sendingDomainId)
    await owner.goto(`/domains/${sendingDomainId}`)
    // The switch follows the server, so it flips only once the save lands.
    const sendingSwitch = owner.getByRole("switch", {
      name: "Enable Sending",
      exact: true,
    })
    if (!(await sendingSwitch.isChecked())) await sendingSwitch.click()
    await expect(sendingSwitch).toBeChecked()
    await expect
      .poll(
        async () =>
          (await backend.query(api.domains.get, { id: sendingDomainId }))
            ?.domain.sending
      )
      .toBe(true)
    const segmentId = await backend.mutation(api.segments.create, {
      organizationId,
      name: "Lane 6B readers",
    })
    const topicId = await backend.mutation(api.topics.create, {
      organizationId,
      name: "Lane 6B news",
      description: "Broadcast coverage",
      defaultSubscription: "opt_out",
      visibility: "public",
    })
    await backend.mutation(api.contacts.upsert, {
      organizationId,
      segmentIds: [segmentId],
      contacts: [
        { email: "broadcast-ada@example.test", firstName: "Ada" },
        { email: "broadcast-fallback@example.test" },
        { email: "broadcast-suppressed@example.test", firstName: "Suppressed" },
        { email: "broadcast-optout@example.test", unsubscribed: true },
      ],
    })
    await backend.mutation(api.suppressions.add, {
      organizationId,
      email: "broadcast-suppressed@example.test",
      reason: "manual",
    })
    const name = "Lane 6B launch"
    const subject = "Lane 6B launch subject"
    const preview = "A persisted preview for our readers"
    const body = "Hello {{{contact.first_name|friend}}}, welcome to lane 6B."
    const id = await createDraft(owner, name)
    const read = () => backend.query(api.broadcasts.get, { organizationId, id })
    await owner.getByTestId("header-from").click()
    await owner
      .getByRole("menuitemradio", { name: sender, exact: true })
      .click()
    await owner.getByTestId("header-audience").click()
    await owner
      .getByRole("menuitemradio", { name: "Lane 6B readers", exact: true })
      .click()
    await owner.getByTestId("header-topic").click()
    await owner
      .getByRole("menuitemradio", { name: "Lane 6B news", exact: true })
      .click()
    await owner.getByTestId("header-subject").fill(subject)
    await owner.getByTestId("header-subject").press("Tab")
    await owner.getByTestId("header-preview-toggle").click()
    await owner.getByTestId("header-preview").fill(preview)
    await owner.getByTestId("header-preview").press("Tab")
    const editor = owner
      .getByTestId("email-content")
      .locator('[contenteditable="true"]')
    await editor.fill(body)
    await expect(owner.getByTestId("save-indicator")).toHaveText("Saved")
    await expect.poll(async () => (await read())?.body?.html).toContain(body)
    await expect
      .poll(async () => (await read())?.row)
      .toMatchObject({
        name,
        from: sender,
        subject,
        preview,
        segmentId,
        topicId,
      })

    await owner.goto("/broadcasts")
    await owner.getByRole("link", { name, exact: true }).click()
    await expect(owner.getByTestId("editor-name")).toHaveValue(name)
    await expect(owner.getByTestId("header-from")).toHaveText(sender)
    await expect(owner.getByTestId("header-subject")).toHaveValue(subject)
    await expect(owner.getByTestId("header-preview")).toHaveValue(preview)
    await expect(owner.getByTestId("header-audience")).toHaveText(
      "Lane 6B readers"
    )
    await expect(owner.getByTestId("header-topic")).toHaveText("Lane 6B news")
    await expect(editor).toContainText(body)
    await owner.getByTestId("editor-review").click()
    await expect(owner.getByTestId("review-check-recipients")).toHaveText(
      "2 contacts will get this email"
    )
    await expect(owner.getByTestId("review-check-content")).toHaveText(
      "Content added"
    )
    await owner.keyboard.press("Escape")

    await owner.getByTestId("editor-test-email").click()
    await owner.getByTestId("test-email-input").fill(ownerEmail)
    await owner.getByTestId("test-email-send").click()
    await expect(toast(owner)).toContainText(`Test email sent to ${ownerEmail}`)
    // The toast acknowledges queueing. Synthetic credentials fail before AWS.
    const testEmails = () =>
      backend.query(api.emails.list, {
        organizationId,
        paginationOpts,
        search: `[Test] ${subject}`,
      })
    await expect
      .poll(async () => (await testEmails()).page.map((row) => row.status))
      .toEqual(["failed"])
    const testEmail = (await testEmails()).page[0]
    const testBody = await backend.query(api.emails.get, { id: testEmail._id })
    expect(testBody?.html).toContain("Hello friend")
    expect((await read())?.row.status).toBe("draft")
    expect(
      (await backend.query(api.broadcastMetrics.stats, { organizationId, id }))
        .recipients
    ).toBe(0)

    await owner.getByTestId("header-when").fill("in 2 days")
    await owner.getByTestId("header-when-option").first().click()
    await owner.getByTestId("editor-review").click()
    await expect(owner.getByTestId("review-check-recipients")).toHaveText(
      "2 contacts will get this email"
    )
    await expect(owner.getByTestId("review-send")).toBeEnabled()
    await owner.getByTestId("review-send").press("Enter")
    await expect(owner).toHaveURL(new RegExp(`/broadcasts/${id}$`))
    await expect.poll(async () => (await read())?.row.status).toBe("scheduled")
    expect((await read())?.row.scheduledAt).toBeGreaterThan(
      Date.now() + 86400000
    )
    await owner.goto("/broadcasts")
    await expect(
      owner.getByRole("row").filter({ hasText: name })
    ).toContainText("Scheduled")
    await owner.getByRole("link", { name, exact: true }).click()
    await owner.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect.poll(async () => (await read())?.row.status).toBe("canceled")
    await expect(owner).toHaveURL(new RegExp(`/broadcasts/${id}/edit$`))
    await owner.getByTestId("header-when").fill("Now")
    await owner.getByTestId("header-when-option").first().click()
    await owner.getByTestId("editor-review").click()
    await expect(owner.getByTestId("review-check-recipients")).toHaveText(
      "2 contacts will get this email"
    )
    await expect(owner.getByTestId("review-send")).toBeEnabled()
    await owner.getByTestId("review-send").press("Enter")
    await expect
      .poll(async () => (await read())?.row.status, { timeout: 45_000 })
      .toBe("failed")
    await expect(owner.getByText("Failed", { exact: true })).toBeVisible()
    await expect(
      owner
        .getByRole("row")
        .filter({
          has: owner.getByRole("cell", { name: "Recipients", exact: true }),
        })
        .getByRole("cell")
        .nth(1)
    ).toHaveText("3")
    await expect(
      owner
        .getByRole("row")
        .filter({
          has: owner.getByRole("cell", { name: "Suppressed", exact: true }),
        })
        .getByRole("cell")
        .nth(1)
    ).toHaveText("1")
    const emails = (
      await backend.query(api.emails.list, {
        organizationId,
        paginationOpts,
        search: subject,
      })
    ).page.filter((row) => row.broadcastId === id)
    expect(emails).toHaveLength(3)
    expect(emails.filter((row) => row.status === "failed")).toHaveLength(2)
    expect(
      emails.find((row) => row.to.includes("broadcast-suppressed@example.test"))
        ?.status
    ).toBe("suppressed")
    for (const [address, greeting] of [
      ["broadcast-ada@example.test", "Hello Ada"],
      ["broadcast-fallback@example.test", "Hello friend"],
    ]) {
      const row = emails.find((email) => email.to.includes(address))!
      expect(
        (await backend.query(api.emails.get, { id: row._id }))?.html
      ).toContain(greeting)
    }
  })

  test("allows member draft edits, refuses another team's reads and writes, and deletes through the UI", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    const id = await createDraft(owner, "Lane 6B disposable")
    await expect
      .poll(
        async () =>
          (await backend.query(api.broadcasts.get, { organizationId, id }))?.row
            .name
      )
      .toBe("Lane 6B disposable")
    const snapshot = (await backend.query(api.teams.snapshot))!
    const membership = snapshot.members.find((row) => row.you)!
    const other = testBackendValue<{ _id: string }>(
      "adapter:create",
      {
        input: {
          model: "organization",
          data: {
            name: "Lane 6B isolation",
            slug: "lane-6b-isolation",
            createdAt: Date.now(),
          },
        },
      },
      "betterAuth"
    )
    const setMembership = (team: string, role: string) =>
      testBackend(
        "adapter:updateOne",
        {
          input: {
            model: "member",
            where: [{ field: "_id", value: membership.id }],
            update: { organizationId: team, role },
          },
        },
        "betterAuth"
      )
    try {
      setMembership(organizationId, "member")
      await owner.getByTestId("editor-name").fill("Lane 6B member draft")
      await owner.getByTestId("editor-name").press("Tab")
      await expect
        .poll(
          async () =>
            (await backend.query(api.broadcasts.get, { organizationId, id }))
              ?.row.name
        )
        .toBe("Lane 6B member draft")
      await refused(
        backend.mutation(api.broadcasts.update, { id, name: "x".repeat(1001) }),
        /name/i
      )
      setMembership(other._id, "member")
      expect(
        (
          await backend.query(api.broadcasts.list, {
            organizationId: other._id,
            paginationOpts,
          })
        ).page
      ).toEqual([])
      await refused(
        backend.query(api.broadcasts.get, { organizationId, id }),
        /permission/i
      )
      await refused(
        backend.mutation(api.broadcasts.update, { id, name: "Intrusion" }),
        /permission/i
      )
      await refused(
        backend.mutation(api.broadcasts.remove, { id }),
        /permission/i
      )
    } finally {
      setMembership(organizationId, "owner")
      testBackend(
        "adapter:deleteOne",
        {
          input: {
            model: "organization",
            where: [{ field: "_id", value: other._id }],
          },
        },
        "betterAuth"
      )
    }
    await owner.goto("/broadcasts")
    const row = owner
      .getByRole("row")
      .filter({ hasText: "Lane 6B member draft" })
    await row.getByRole("button", { name: "More options", exact: true }).click()
    await owner.getByRole("menuitem", { name: "Delete", exact: true }).click()
    await owner
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click()
    await expect(toast(owner)).toContainText("Broadcast deleted")
    await expect(row).toHaveCount(0)
    expect(
      await backend.query(api.broadcasts.get, { organizationId, id })
    ).toBeNull()
  })

  test("creates, lists, retrieves and deletes REST broadcasts with a UI-created API key", async () => {
    const { owner } = state()
    const headers = await createApiKey(owner, "Lane 6B broadcasts REST")
    const url = `${httpOrigin()}/broadcasts`
    const input = {
      name: "Lane 6B REST draft",
      from: sender,
      subject: "REST subject",
      preview_text: "REST preview",
      html: "<p>Hello {{{contact.first_name|friend}}}</p>",
    }
    const created = await owner.request.post(url, { headers, data: input })
    expect(created.status()).toBe(200)
    const { id } = await created.json()
    expect(id).toEqual(expect.any(String))
    const list = await owner.request.get(`${url}?limit=100`, { headers })
    expect(list.status()).toBe(200)
    expect(await list.json()).toMatchObject({
      object: "list",
      data: expect.arrayContaining([
        expect.objectContaining({ id, name: input.name, status: "draft" }),
      ]),
    })
    const get = await owner.request.get(`${url}/${id}`, { headers })
    expect(get.status()).toBe(200)
    expect(await get.json()).toMatchObject({
      object: "broadcast",
      id,
      ...input,
      status: "draft",
    })
    const removed = await owner.request.delete(`${url}/${id}`, { headers })
    expect(removed.status()).toBe(200)
    expect(await removed.json()).toEqual({
      object: "broadcast",
      id,
      deleted: true,
    })
    expect(
      (await owner.request.get(`${url}/${id}`, { headers })).status()
    ).toBe(404)
  })

  test("shows received mail, serves signed attachments, and emits one metadata-only received webhook", async () => {
    test.setTimeout(120_000)
    const { owner, organizationId, sendingDomainId } = state()
    const backend = await client(owner)
    await seedBroadcastSender(owner, sendingDomainId)
    await owner.goto(`/domains/${sendingDomainId}`)
    // Receiving lives under DNS records, not the Configuration tab.
    // The switch follows the server, so it flips only once the save lands.
    const receivingSwitch = owner.getByRole("switch", {
      name: "Enable Receiving",
      exact: true,
    })
    if (!(await receivingSwitch.isChecked())) await receivingSwitch.click()
    await expect(receivingSwitch).toBeChecked()
    await expect
      .poll(
        async () =>
          (await backend.query(api.domains.get, { id: sendingDomainId }))
            ?.domain.receiving
      )
      .toBe(true)
    // Infrastructure refresh cannot decrypt the synthetic AWS credentials.
    await expect
      .poll(
        async () =>
          (await backend.query(api.domains.get, { id: sendingDomainId }))
            ?.domain.phase,
        { timeout: 45_000 }
      )
      .toBe("failed")
    testBackend("domains:finish", {
      id: sendingDomainId,
      changes: {},
      receiptRuleSet: "opensend-e2e-inbound",
    })
    await refused(
      backend.action(api.webhooks.create, {
        organizationId,
        endpoint: "https://host.docker.internal/received",
        events: ["email.received"],
      }),
      /public hostname/i
    )
    // No local-host exception exists for webhooks. A reserved public-shaped
    // name allows checking the durable delivery without sending to a real host.
    const webhookId = await backend.action(api.webhooks.create, {
      organizationId,
      endpoint: "https://lane-6b.invalid/received",
      events: ["email.received"],
    })
    try {
      const headers = await createApiKey(owner, "Lane 6B received REST")
      const id = await seedReceivedMessage(
        owner,
        organizationId,
        sendingDomainId,
        headers
      )
      const fixture = receivedFixture
      await owner.goto("/emails/receiving")
      await expect(
        owner.getByText("*@onboarding.example.test", { exact: true })
      ).toBeVisible()
      const row = owner.getByRole("row").filter({ hasText: fixture.subject })
      await expect(row).toContainText(fixture.from)
      await row.getByRole("link").first().click()
      await expect(owner).toHaveURL(new RegExp(`/emails/receiving/${id}$`))
      await expect(
        owner.getByRole("heading", { name: fixture.from, exact: true })
      ).toBeVisible()
      await expect(owner.getByText(fixture.to, { exact: true })).toBeVisible()
      await expect(
        owner.getByText(fixture.subject, { exact: true }).first()
      ).toBeVisible()
      await expect(
        owner
          .frameLocator(`iframe[title="${fixture.subject}"]`)
          .getByText("HTML received in lane 6B.")
      ).toBeVisible()
      await owner.getByRole("tab", { name: "Plain text", exact: true }).click()
      await expect(
        owner.getByRole("tabpanel", { name: "Plain text", exact: true })
      ).toContainText(fixture.text)
      await owner.getByRole("tab", { name: "HTML", exact: true }).click()
      await expect(
        owner.getByRole("tabpanel", { name: "HTML", exact: true })
      ).toContainText(fixture.html)

      // Detail has no attachment/authentication controls; REST exposes them.
      const url = `${httpOrigin()}/emails/receiving`
      for (const path of [url, `${url}/${id}`, `${url}/${id}/attachments`])
        expect((await owner.request.get(path)).status()).toBe(401)
      const list = await owner.request.get(`${url}?limit=100`, { headers })
      expect(list.status()).toBe(200)
      expect(await list.json()).toMatchObject({
        object: "list",
        data: expect.arrayContaining([
          expect.objectContaining({ id, subject: fixture.subject }),
        ]),
      })
      const get = await owner.request.get(`${url}/${id}`, { headers })
      expect(get.status()).toBe(200)
      const email = await get.json()
      expect(email).toMatchObject({
        object: "email",
        id,
        from: fixture.from,
        to: [fixture.to],
        subject: fixture.subject,
        html: fixture.html,
        text: fixture.text,
        received_for: [fixture.to],
        authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      })
      const raw = await owner.request.get(email.raw.download_url)
      expect(raw.status()).toBe(200)
      expect(await raw.text()).toContain(`Subject: ${fixture.subject}`)
      expect(email.attachments).toHaveLength(1)
      const attachmentId = email.attachments[0].id
      const files = await owner.request.get(`${url}/${id}/attachments`, {
        headers,
      })
      expect(files.status()).toBe(200)
      expect(await files.json()).toMatchObject({
        object: "list",
        has_more: false,
        data: [
          expect.objectContaining({
            id: attachmentId,
            filename: fixture.filename,
            size: fixture.bytes.length,
          }),
        ],
      })
      const file = await owner.request.get(
        `${url}/${id}/attachments/${attachmentId}`,
        { headers }
      )
      expect(file.status()).toBe(200)
      const attachment = await file.json()
      expect(attachment).toMatchObject({
        object: "attachment",
        id: attachmentId,
        filename: fixture.filename,
        content_type: "text/plain",
        size: fixture.bytes.length,
      })
      const download = await owner.request.get(attachment.download_url)
      expect(download.status()).toBe(200)
      expect(download.headers()["content-disposition"]).toContain(
        fixture.filename
      )
      expect(await download.body()).toEqual(fixture.bytes)
      const tampered = new URL(attachment.download_url)
      const parts = tampered.pathname.split(".")
      parts[parts.length - 1] =
        (parts.at(-1)!.startsWith("A") ? "B" : "A") + parts.at(-1)!.slice(1)
      tampered.pathname = parts.join(".")
      expect((await owner.request.get(tampered.href)).status()).toBe(404)
      const deliveries = () =>
        backend.query(api.webhooks.deliveries, {
          webhookId,
          event: "email.received",
          paginationOpts,
        })
      await expect.poll(async () => (await deliveries()).page.length).toBe(1)
      const delivery = (await deliveries()).page[0]
      expect(delivery.messageId).toMatch(/^msg_/)
      expect(delivery.payload).toEqual({
        type: "email.received",
        created_at: expect.any(String),
        data: {
          email_id: id,
          created_at: expect.any(String),
          from: fixture.from,
          to: [fixture.to],
          cc: [],
          bcc: [],
          received_for: [fixture.to],
          message_id: "<lane-6b@example.test>",
          subject: fixture.subject,
          attachments: [
            {
              id: attachmentId,
              filename: fixture.filename,
              content_type: "text/plain",
              content_disposition: "attachment",
              content_id: null,
            },
          ],
        },
      })
      expect(
        (
          await backend.query(api.received.list, {
            organizationId,
            paginationOpts,
            search: fixture.subject,
          })
        ).page
      ).toHaveLength(1)
    } finally {
      await backend.mutation(api.webhooks.remove, { id: webhookId })
    }
  })
}
