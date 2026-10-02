import { expect, type Page } from "@playwright/test"
/** Shared review matrix for the redesigned screens; the lead's e2e run writes it. */
export async function playgroundShots(page: Page, name: string) {
  const viewport = page.viewportSize()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" })
      await page.evaluate((theme) => {
        document.documentElement.classList.remove("light", "dark")
        document.documentElement.classList.add(theme)
      }, theme)
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        .toBe(true)
      await page.screenshot({
        path: `${process.env.OPENSEND_TEST_RESULTS}/${name}-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      })
    }
  }
  await page.emulateMedia({ colorScheme: "light" })
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark")
    document.documentElement.classList.add("light")
  })
  if (viewport) await page.setViewportSize(viewport)
}
