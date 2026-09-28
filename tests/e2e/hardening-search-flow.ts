import { expect, test, type Page } from "@playwright/test"
import { format, startOfMonth, subMonths } from "date-fns"
import { api } from "../../convex/_generated/api"
import { createApiKey, createDraft } from "./broadcast-received-flow"
import { client, testBackendValue } from "./ses-fixtures"

const httpOrigin = () => process.env.OPENSEND_CALLBACK_ORIGIN!
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/${name}.png`,
  })

type State = {
  owner: Page
  organizationId: string
  ownerEmail: string
  ownerPassword: string
  login: (page: Page, email: string, password: string) => Promise<void>
}

/** Register inside auth.spec's serial describe, while the owner has no MFA. */
export function hardeningSearchTests(state: () => State) {
  test("finds a segment beyond the first twenty by searching the audience menu", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    // Created oldest first, so "Search probe 01" is outside the newest 20.
    for (let i = 1; i <= 25; i++)
      await backend.mutation(api.segments.create, {
        organizationId,
        name: `Search probe ${String(i).padStart(2, "0")}`,
      })
    await createDraft(owner, "Search probe broadcast")
    await owner.getByTestId("header-audience").click()
    const menu = owner.getByRole("listbox")
    await expect(
      menu.getByRole("option", { name: "Search probe 25", exact: true })
    ).toBeVisible()
    await expect(
      menu.getByRole("option", { name: "Search probe 01", exact: true })
    ).toHaveCount(0)
    expect(await menu.getByRole("option").count()).toBeLessThanOrEqual(21)
    await owner.getByRole("combobox", { name: "Search" }).fill("probe 01")
    const found = menu.getByRole("option", {
      name: "Search probe 01",
      exact: true,
    })
    await expect(found).toBeVisible()
    await shot(owner, "search-probe-menu")
    await found.click()
    await expect(owner.getByTestId("header-audience")).toContainText(
      "Search probe 01"
    )
    // The choice outlives the search: reload and read it back by id.
    await owner.waitForTimeout(1500)
    await owner.reload()
    await expect(owner.getByTestId("header-audience")).toContainText(
      "Search probe 01"
    )
    await shot(owner, "search-probe-chosen")
  })

  test("replays an Idempotency-Key once and refuses a changed body", async () => {
    const { owner } = state()
    const headers = await createApiKey(owner, "Idempotency probe")
    const post = (body: unknown) =>
      fetch(`${httpOrigin()}/contacts`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": "idempotency-probe-1",
        },
        body: JSON.stringify(body),
      })
    const body = { email: "idempotent@example.test", first_name: "Once" }
    const first = await post(body)
    expect(first.status).toBeLessThan(300)
    const created = (await first.json()) as { id: string }
    const again = await post(body)
    expect(again.status).toBe(first.status)
    expect(await again.json()).toEqual(created)
    const changed = await post({ ...body, first_name: "Twice" })
    expect(changed.status).toBe(409)
    expect(((await changed.json()) as { name: string }).name).toBe(
      "invalid_idempotent_request"
    )
    await owner.goto("/contacts")
    await owner.getByPlaceholder("Search contacts…").fill("idempotent@")
    await expect(
      owner.getByText("idempotent@example.test", { exact: true })
    ).toHaveCount(1)
  })

  test("imports a 250-row CSV through background jobs", async () => {
    test.setTimeout(120_000)
    const { owner } = state()
    await owner.goto("/contacts")
    await owner.getByRole("button", { name: "Add Contacts" }).click()
    await owner.getByRole("menuitem", { name: "Import CSV" }).click()
    const dialog = owner.getByRole("dialog", { name: "Import CSV" })
    const rows = Array.from(
      { length: 250 },
      (_, i) => `bulk-${i}@example.test,Bulk,${i}`
    )
    await dialog.getByLabel("CSV file").setInputFiles({
      name: "bulk.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(["email,first_name,last_name", ...rows].join("\n")),
    })
    await expect(dialog.getByText("bulk.csv · 250 rows")).toBeVisible()
    await dialog.getByRole("button", { name: "Import", exact: true }).click()
    await expect(owner.getByText("250 created, 0 updated.")).toBeVisible({
      timeout: 90_000,
    })
    await owner.getByPlaceholder("Search contacts…").fill("bulk-249@")
    await expect(
      owner.getByText("bulk-249@example.test", { exact: true })
    ).toBeVisible()
    await shot(owner, "csv-import-done")
  })

  test("charts a custom metrics range longer than 31 days", async () => {
    const { owner } = state()
    const errors: Error[] = []
    const record = (error: Error) => errors.push(error)
    owner.on("pageerror", record)
    await owner.goto("/metrics")
    await owner.getByRole("button", { name: /^Date range:/ }).click()
    const from = startOfMonth(subMonths(new Date(), 2))
    for (let i = 0; i < 2; i++)
      await owner
        .getByRole("button", { name: "Go to the Previous Month" })
        .click()
    await owner
      .getByRole("button", { name: new RegExp(format(from, "PPPP")) })
      .click()
    // An earlier start keeps today as the end: a range of 2–3 months.
    await expect(
      owner.getByRole("button", { name: /^Date range:/ })
    ).toContainText(format(from, "MMM d"))
    await expect(owner.getByRole("heading", { name: "Metrics" })).toBeVisible()
    // Rates render once every metrics query for the range has answered.
    await expect(owner.getByText(/^\d+(\.\d+)?%$/).first()).toBeVisible()
    await expect(owner.getByText("Something went wrong")).toHaveCount(0)
    await shot(owner, "metrics-long-range")
    owner.off("pageerror", record)
    expect(errors).toEqual([])
  })

  test("operator recovery prints a working one-time reset link", async () => {
    const { owner, ownerEmail, ownerPassword, login } = state()
    const link = testBackendValue<string>("accountRecovery:resetPassword", {
      email: ownerEmail,
    })
    expect(link).toMatch(/\/reset-password/)
    const page = await owner.context().browser()!.newPage()
    await page.goto(link)
    // The same password keeps the rest of the suite's logins valid.
    await page.getByLabel("Password", { exact: true }).fill(ownerPassword)
    await page.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Password reset")
    await page.goto(link)
    await page.getByLabel("Password", { exact: true }).fill(ownerPassword)
    await page.getByRole("button", { name: "Continue", exact: true }).click()
    // The token was spent by the first reset.
    await expect(
      page.getByText("The link or sign-in attempt failed", { exact: false })
    ).toBeVisible()
    await page.close()
    // Reset revokes sessions, so the owner signs in again.
    await login(owner, ownerEmail, ownerPassword)
  })
}
