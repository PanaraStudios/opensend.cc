import { expect, test, type Page } from "@playwright/test"
import { createApiKey } from "./broadcast-received-flow"

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/contacts-phone-${name}.png`,
    fullPage: true,
  })

export function contactsPhoneTests(state: () => { owner: Page }) {
  test("creates and searches phone-only contacts from the dashboard and REST, rejecting duplicate phones", async () => {
    const { owner } = state()
    const phone = "+14155552671"
    await owner.goto("/contacts")
    await owner
      .getByRole("button", { name: "Add Contacts", exact: true })
      .first()
      .click()
    await owner
      .getByRole("menuitem", { name: "Add Manually", exact: true })
      .click()
    const add = owner.getByRole("dialog", { name: "Add manually", exact: true })
    await add.getByLabel("Phone", { exact: true }).fill("+1 (415) 555-2671")
    await add.getByRole("button", { name: "Add", exact: true }).click()
    await expect(add).toBeHidden()
    await expect(owner).toHaveURL(/\/contacts\/[^/]+$/)
    await expect(
      owner.getByRole("heading", { name: phone, exact: true })
    ).toBeVisible()
    await expect(owner.getByLabel("Email", { exact: true })).toHaveValue("")
    await expect(owner.getByLabel("Phone", { exact: true })).toHaveValue(phone)
    await shot(owner, "detail")
    await owner.goto("/contacts")
    await expect(
      owner.getByRole("columnheader", { name: "Phone", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("row").filter({ hasText: phone })
    ).toBeVisible()
    await shot(owner, "list")
    await owner.getByPlaceholder("Search contacts…").fill("4155552671")
    await expect(
      owner.getByRole("row").filter({ hasText: phone })
    ).toBeVisible()
    await shot(owner, "search")
    await owner
      .getByRole("button", { name: "Add Contacts", exact: true })
      .first()
      .click()
    await owner
      .getByRole("menuitem", { name: "Add Manually", exact: true })
      .click()
    await add.getByLabel("Phone", { exact: true }).fill(phone)
    await add.getByRole("button", { name: "Add", exact: true }).click()
    await expect(
      add.getByText("That phone number already exists", { exact: true })
    ).toBeVisible()
    await shot(owner, "duplicate")
    await add.getByRole("button", { name: "Cancel", exact: true }).click()

    const headers = await createApiKey(owner, "Lane 1B phone contacts")
    const origin = process.env.OPENSEND_CALLBACK_ORIGIN!
    const response = await owner.request.post(`${origin}/contacts`, {
      headers,
      data: { phone: "+442079460958" },
    })
    expect(response.status()).toBe(201)
    const { id } = await response.json()
    const get = await owner.request.get(`${origin}/contacts/${id}`, { headers })
    expect(await get.json()).toMatchObject({
      id,
      email: null,
      phone: "+442079460958",
    })
    await owner.goto("/contacts")
    const row = owner.getByRole("row").filter({ hasText: "+442079460958" })
    await expect(row).toBeVisible()
    await expect(
      row.getByRole("link", { name: "+442079460958", exact: true })
    ).toHaveAttribute("href", `/contacts/${id}`)
    await shot(owner, "rest")
  })
  test("an empty segment explains membership and adds a contact through search", async () => {
    const { owner } = state()
    const headers = await createApiKey(owner, "QA segment picker")
    const origin = process.env.OPENSEND_CALLBACK_ORIGIN!
    const response = await owner.request.post(`${origin}/segments`, {
      headers,
      data: { name: "QA empty segment" },
    })
    expect(response.ok()).toBeTruthy()
    const { id } = await response.json()
    await owner.goto(`/segments/${id}`)
    await expect(
      owner.getByText("No contacts in this segment", { exact: true })
    ).toBeVisible()
    await expect(owner.getByText(/bulk action in Contacts/)).toBeVisible()
    const emptyState = owner.locator('[data-slot="empty"]').filter({
      has: owner.getByText("No contacts in this segment", { exact: true }),
    })
    const add = emptyState.getByRole("button", {
      name: "Add contacts",
      exact: true,
    })
    const contacts = emptyState.getByRole("button", {
      name: "Go to contacts",
      exact: true,
    })
    await expect(add).toHaveClass(/bg-primary/)
    await expect(contacts).toHaveClass(/bg-background/)
    await expect(contacts).toHaveAttribute("href", "/contacts")
    await expect(
      emptyState.locator('[data-slot="empty-content"] > *').first()
    ).toHaveText("Add contacts")
    await add.click()
    const dialog = owner.getByRole("dialog", {
      name: "Add contacts",
      exact: true,
    })
    await dialog.getByLabel("Contact", { exact: true }).click()
    await owner.getByPlaceholder("Search contacts…").fill("442079460958")
    await owner
      .getByRole("option", { name: "+442079460958", exact: true })
      .click()
    await dialog
      .getByRole("button", { name: "Add contact", exact: true })
      .click()
    await expect(dialog).toBeHidden()
    await expect(
      owner.getByRole("row").filter({ hasText: "+442079460958" })
    ).toBeVisible()
    await expect(
      owner.getByText("No contacts in this segment", { exact: true })
    ).toHaveCount(0)
  })
}
