import { expect, test, type Page } from "@playwright/test"
import type { Id } from "../../convex/_generated/dataModel"
import { createApiKey } from "./broadcast-received-flow"
import { client, seedBroadcastSender } from "./ses-fixtures"
import { api } from "../../convex/_generated/api"
import { PHONE_ID } from "./meta-fixtures"

/** Registered after Meta inbound setup, which opens this recipient's window. */
export function messagesTests(
  state: () => {
    owner: Page
    organizationId: string
    sendingDomainId: Id<"domains">
  }
) {
  test("unified email and WhatsApp sends appear in Messages Sending", async () => {
    const { owner, organizationId, sendingDomainId } = state()
    await seedBroadcastSender(owner, sendingDomainId)
    const backend = await client(owner)
    const domain = await backend.query(api.domains.get, { id: sendingDomainId })
    const headers = await createApiKey(owner, "Unified messages E2E")
    const origin = process.env.OPENSEND_CALLBACK_ORIGIN!
    const marker = `Unified message ${Date.now()}`
    const ids = []
    for (const body of [
      {
        channel: "email",
        from: `hello@${domain!.domain.name}`,
        to: "recipient@example.test",
        subject: `${marker} email`,
        text: `${marker} email`,
      },
      {
        channel: "whatsapp",
        from: PHONE_ID,
        to: "16505551234",
        text: `${marker} WhatsApp`,
      },
    ]) {
      const response = await owner.request.post(`${origin}/messages`, {
        headers,
        data: body,
      })
      expect(response.status(), await response.text()).toBe(200)
      ids.push((await response.json()).id)
    }
    await expect
      .poll(async () => {
        const result = await backend.query(api.messages.sending, {
          organizationId,
          search: marker,
          paginationOpts: { numItems: 20, cursor: null },
        })
        return result.page.map((row) =>
          row.kind === "email" ? row.email._id : row.message._id
        )
      })
      .toEqual(expect.arrayContaining(ids))
    await owner.goto("/emails")
    await owner
      .getByRole("button", { name: "Send message", exact: true })
      .click()
    const compose = owner.getByRole("dialog", {
      name: "Send message",
      exact: true,
    })
    await expect(compose.getByLabel("Channel", { exact: true })).toContainText(
      "Email"
    )
    await compose.getByLabel("Channel", { exact: true }).click()
    await expect(owner.getByRole("option").first()).toHaveText("Email")
    await owner.keyboard.press("Escape")
    await owner.keyboard.press("Escape")
    await owner.getByPlaceholder("Search messages…").fill(marker)
    await expect(
      owner.getByText(`${marker} email`, { exact: true })
    ).toBeVisible()
    await expect(
      owner.getByText(`${marker} WhatsApp`, { exact: true })
    ).toBeVisible()
  })
}
