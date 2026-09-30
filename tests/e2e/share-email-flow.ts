import { expect, test, type Page } from "@playwright/test"
import { seedShareEmail, seedExpiredEmailShare } from "./ses-fixtures"

type State = { owner: Page; organizationId: string; sendingDomainId: string }

async function screenshots(page: Page, name: string) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      localStorage.setItem("theme", theme)
      document.documentElement.classList.toggle("dark", theme === "dark")
      document.documentElement.classList.toggle("light", theme === "light")
    }, theme)
    await page.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/share-${name}-${theme}.png`,
      fullPage: true,
    })
  }
}

/** Runs after hardening-search-flow, with independent synthetic sent mail. */
export function shareEmailTests(state: () => State) {
  test("shares from the dashboard into a fresh signed-out context and rejects an expired link", async () => {
    const { owner, organizationId, sendingDomainId } = state()
    const email = seedShareEmail(organizationId, sendingDomainId)
    const publicContext = await owner.context().browser()!.newContext()
    try {
      await owner.goto(`/emails/${email.id}`)
      await owner
        .getByRole("button", { name: "More options", exact: true })
        .click()
      await owner
        .getByRole("menuitem", { name: "Share email", exact: true })
        .click()
      const dialog = owner.getByRole("dialog", {
        name: "Share email",
        exact: true,
      })
      // Resend's flow: choose how long the link lasts, then generate it.
      await expect(
        dialog.getByRole("combobox", { name: "Link expires after" })
      ).toContainText("48 hours")
      await screenshots(owner, "dialog")
      await dialog.getByRole("combobox", { name: "Link expires after" }).click()
      await owner.getByRole("option", { name: "24 hours", exact: true }).click()
      await dialog.getByRole("combobox", { name: "Link expires after" }).focus()
      await owner.keyboard.press("ControlOrMeta+Enter")
      const link = dialog.getByRole("textbox", {
        name: "Share link",
        exact: true,
      })
      await expect(link).toHaveValue(/\/shared\?token=[a-f0-9]{64}$/)
      await expect(dialog.getByText(/^Expires /)).toBeVisible()
      await expect(
        dialog.getByRole("button", { name: "Copy share link" })
      ).toBeVisible()
      await screenshots(owner, "dialog-link")
      const url = await link.inputValue()
      const page = await publicContext.newPage()
      const response = await page.goto(url)
      expect(response?.headers()["cache-control"]).toContain("no-store")
      await expect(page).toHaveTitle(/Shared email/)
      await expect(
        page
          .frameLocator("iframe")
          .getByText("A message shared without signing in.")
      ).toBeVisible()
      await expect(page.locator("iframe")).toHaveAttribute("sandbox", "")
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/
      )
      await expect(page.getByText("hidden@example.test")).toHaveCount(0)
      await expect(page.getByRole("navigation")).toHaveCount(0)
      await screenshots(page, "public")
      const expired = seedExpiredEmailShare(organizationId, email.id)
      await page.goto(new URL(`/shared?token=${expired}`, url).href)
      await expect(
        page.getByText("This share link has expired or is invalid")
      ).toBeVisible()
      await expect(page.locator("iframe")).toHaveCount(0)
      await screenshots(page, "expired")
      await page.goto(new URL("/shared?token=invalid", url).href)
      await expect(
        page.getByText("This share link has expired or is invalid")
      ).toBeVisible()
    } finally {
      await publicContext.close()
    }
  })
}
