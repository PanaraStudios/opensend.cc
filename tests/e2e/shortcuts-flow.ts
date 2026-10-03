import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"

type State = {
  owner: Page
  organizationId: string
  createTeam: (page: Page, name: string) => Promise<void>
}
const unfocus = (page: Page) => page.getByRole("heading", { level: 1 }).click()
const modifier = (page: Page) =>
  page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"
  )

export function shortcutTests(state: () => State) {
  test("discovers shortcuts, navigates, searches, opens rows and creates without leaving the keyboard", async () => {
    const { owner } = state()
    await owner.goto("/emails")
    await unfocus(owner)
    await owner.keyboard.press("?")
    const help = owner.getByRole("dialog", { name: "Keyboard shortcuts" })
    await expect(help).toBeVisible()
    for (const theme of ["light", "dark"] as const) {
      await owner.evaluate(
        (value) =>
          document.documentElement.classList.toggle("dark", value === "dark"),
        theme
      )
      await owner.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/shortcuts-${theme}.png`,
      })
    }
    await owner.evaluate(() =>
      document.documentElement.classList.remove("dark")
    )
    await owner.keyboard.press("Escape")
    await owner.keyboard.press("g")
    await owner.keyboard.press("d")
    // Domains' old key opens Channels on email.
    await expect(owner).toHaveURL(/\/channels\?type=email$/)
    await owner.keyboard.press("/")
    const search = owner.getByPlaceholder("Search channels…")
    await expect(search).toBeFocused()
    await owner.keyboard.type("gc?/")
    await expect(search).toHaveValue("gc?/")
    await expect(owner.getByRole("dialog")).toHaveCount(0)
    await expect(owner).toHaveURL(/\/channels\?type=email$/)
    await search.fill("")
    await unfocus(owner)
    const rows = owner.locator("tbody tr")
    await expect(rows.first()).toBeVisible()
    await owner.keyboard.press("j")
    await expect(rows.first()).toHaveAttribute(
      "data-keyboard-highlight",
      "true"
    )
    await owner.keyboard.press("j")
    await owner.keyboard.press("k")
    await expect(rows.first()).toHaveAttribute(
      "data-keyboard-highlight",
      "true"
    )
    const href = await rows
      .first()
      .locator("a[href]")
      .first()
      .getAttribute("href")
    await owner.keyboard.press("Enter")
    await expect(owner).toHaveURL(new RegExp(`${href}$`))
    // The detail page registers Esc once its header renders.
    await expect(
      owner.getByRole("button", { name: "Channels", exact: true })
    ).toHaveAttribute("aria-keyshortcuts", "Escape")
    await owner.keyboard.press("Escape")
    await expect(owner).toHaveURL(/\/channels$/)
    // C opens Add channel; its first item is the add-domain dialog.
    await owner.keyboard.press("c")
    await owner
      .getByRole("menuitem", { name: "Email domain", exact: true })
      .click()
    const add = owner.getByRole("dialog", { name: "Add domain", exact: true })
    await expect(add).toBeVisible()
    await owner.keyboard.press("Escape")
    await expect(add).toBeHidden()
    await unfocus(owner)
    await owner.keyboard.press(`${await modifier(owner)}+k`)
    await expect(
      owner.getByRole("dialog", { name: "Search", exact: true })
    ).toBeVisible()
    const palette = owner.getByRole("dialog", { name: "Search", exact: true })
    await palette
      .getByPlaceholder("Search pages, emails, contacts…")
      .fill("Playground Inbox")
    await palette
      .getByRole("option", { name: "Playground · Inbox", exact: true })
      .click()
    await expect(owner).toHaveURL(/\/playground\/inbox$/)
    await unfocus(owner)
    await owner.keyboard.press("g")
    await owner.keyboard.press("p")
    await expect(owner).toHaveURL(/\/playground\/inbox$/)
  })

  test("selects only rendered contacts and opens delete confirmation without deleting", async () => {
    const { owner, organizationId } = state()
    const backend = await client(owner)
    await backend.mutation(api.contacts.upsert, {
      organizationId,
      contacts: [
        { email: "shortcuts-one@example.test" },
        { email: "shortcuts-two@example.test" },
      ],
      segmentIds: [],
    })
    await owner.goto("/contacts")
    await unfocus(owner)
    const rows = owner.locator("tbody tr")
    await expect(rows.first()).toBeVisible()
    await owner.keyboard.press("j")
    await owner.keyboard.press("x")
    await expect(rows.first().getByRole("checkbox")).toBeChecked()
    await owner.keyboard.press(`${await modifier(owner)}+a`)
    const boxes = rows.getByRole("checkbox")
    for (const box of await boxes.all()) await expect(box).toBeChecked()
    await owner.keyboard.press("Backspace")
    await expect(owner.getByRole("alertdialog")).toBeVisible()
    await owner.keyboard.press("Escape")
    await expect(owner.getByRole("alertdialog")).toBeHidden()
    await unfocus(owner)
    await owner.keyboard.press("Escape")
    await expect(
      owner.getByRole("toolbar", { name: "Bulk actions" })
    ).toHaveCount(0)
    await expect(owner.locator('[data-keyboard-highlight="true"]')).toHaveCount(
      0
    )
  })

  test("Cmd/Ctrl+Enter respects type-to-confirm before deleting a disposable team", async () => {
    const { owner, organizationId, createTeam } = state()
    await owner.goto("/profile")
    await createTeam(owner, "Shortcuts disposable team")
    const backend = await client(owner)
    try {
      const row = owner
        .locator('[data-slot="item"]')
        .filter({ hasText: "Shortcuts disposable team" })
      await row.getByRole("button", { name: "More options" }).click()
      await owner.getByRole("menuitem", { name: "Leave", exact: true }).click()
      const dialog = owner.getByRole("alertdialog", {
        name: "Delete team",
        exact: true,
      })
      const input = dialog.getByRole("textbox")
      await input.fill("wrong")
      const mod = await modifier(owner)
      await owner.keyboard.press(`${mod}+Enter`)
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole("button", { name: "Delete team", exact: true })
      ).toBeDisabled()
      await input.fill("DELETE")
      await owner.keyboard.press(`${mod}+Enter`)
      await expect(dialog).toBeHidden()
      await expect(row).toHaveCount(0)
    } finally {
      await backend.mutation(api.teams.switchTeam, { organizationId })
      await owner.goto("/emails")
    }
  })
}
