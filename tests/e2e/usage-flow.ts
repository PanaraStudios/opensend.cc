import { expect, test, type Page } from "@playwright/test"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../convex/_generated/api"
import { createApiKey } from "./broadcast-received-flow"
import { client, seedReceivedMessage } from "./ses-fixtures"

type State = { owner: Page; organizationId: string; sendingDomainId: string }
type Usage = FunctionReturnType<typeof api.usage.get>["usage"]

export function usageTests(state: () => State) {
  test("Settings Usage matches the REST API after receiving an email", async () => {
    const { owner, organizationId, sendingDomainId } = state()
    const headers = await createApiKey(owner, "Usage probe")
    const backend = await client(owner)
    const before = await backend.query(api.usage.get, { organizationId })
    await seedReceivedMessage(
      owner,
      organizationId,
      sendingDomainId,
      headers,
      "lane-9c-usage"
    )
    const after = await backend.query(api.usage.get, { organizationId })
    expect(after.usage.emails.daily.received).toBe(
      before.usage.emails.daily.received + 1
    )
    await owner.goto("/settings/team")
    await owner.getByRole("tab", { name: "Usage", exact: true }).click()
    await expect(owner).toHaveURL(/\/settings\/usage$/)
    const response = await owner.request.get(
      `${process.env.OPENSEND_CALLBACK_ORIGIN}/usage`,
      { headers }
    )
    expect(response.status()).toBe(200)
    const usage = (await response.json()) as Usage
    expect(usage).toEqual(after.usage)
    for (const [title, quota] of [
      ["Emails today", usage.emails.daily],
      ["Emails this month", usage.emails.monthly],
      ["Contacts", usage.contacts],
      ["Segments", usage.segments],
      ["Broadcasts sent", usage.broadcasts],
    ] as const) {
      const limit =
        quota.limit === null ? "Unlimited" : quota.limit.toLocaleString("en-US")
      await expect(
        owner
          .getByRole("region", { name: title, exact: true })
          .getByTestId("usage-value")
      ).toHaveText(`${quota.used.toLocaleString("en-US")} / ${limit}`)
    }
    await expect(
      owner.getByText("Shared Amazon SES quota", { exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("link", { name: "Amazon SES settings" })
    ).toHaveAttribute("href", "/settings/ses")
    const original = await owner.evaluate(() => localStorage.getItem("theme"))
    for (const theme of ["light", "dark"]) {
      await owner.evaluate(
        (value) => localStorage.setItem("theme", value),
        theme
      )
      await owner.reload()
      await expect(
        owner.getByRole("heading", { name: "Emails today" })
      ).toBeVisible()
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/usage-${theme}.png`,
        fullPage: true,
      })
    }
    await owner.evaluate(
      (value) =>
        value === null
          ? localStorage.removeItem("theme")
          : localStorage.setItem("theme", value),
      original
    )
    await owner.reload()
  })
}
