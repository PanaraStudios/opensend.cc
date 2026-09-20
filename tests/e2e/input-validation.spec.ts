import { expect, test } from "@playwright/test"

test("inputs show one focused validation popover without form-specific wrappers", async ({
  page,
}) => {
  let signups = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/sign-up/email"))
      signups++
  })
  await page.goto("/signup")
  const name = page.getByLabel("Name", { exact: true })
  const email = page.getByLabel("Email", { exact: true })
  const password = page.getByLabel("Password", { exact: true })
  const submit = page.getByRole("button", {
    name: "Create account",
    exact: true,
  })
  const alert = page.locator('[data-slot="inline-toast"]')
  await submit.click()
  await expect(name).toBeFocused()
  await expect(alert).toHaveCount(1)
  await expect(alert).toContainText("Fill out this field")
  await name.fill("Validation Tester")
  await expect(alert).toHaveCount(0)
  await submit.click()
  await expect(email).toBeFocused()
  await expect(alert).toContainText("Enter your email")
  await email.fill("invalid@")
  await submit.click()
  await expect(email).toBeFocused()
  await expect(email).toHaveAttribute("aria-invalid", "true")
  await expect(alert).toContainText("Enter a valid email")
  const description = await email.getAttribute("aria-describedby")
  expect(description?.split(" ")).toContain(await alert.getAttribute("id"))
  await email.press("Escape")
  await expect(alert).toHaveCount(0)
  await email.press("Enter")
  await expect(alert).toContainText("Enter a valid email")
  await email.fill("valid@example.test")
  await password.pressSequentially("short")
  await submit.click()
  await expect(password).toBeFocused()
  await expect(alert).toContainText("Use at least 12 characters")
  await password.evaluate((input) => (input as HTMLInputElement).form!.reset())
  await expect(alert).toHaveCount(0)
  await expect(password).not.toHaveAttribute("aria-invalid", "true")
  expect(signups).toBe(0)
})

test("shared validation respects custom validity and clears on reset", async ({
  page,
}) => {
  await page.goto("/signup")
  const input = page.getByLabel("Name", { exact: true })
  const alert = page.locator('[data-slot="inline-toast"]')
  await input.fill("Example")
  await input.evaluate((node) => {
    const element = node as HTMLInputElement
    element.setCustomValidity("That name is already used")
    element.reportValidity()
  })
  await expect(alert).toContainText("That name is already used")
  await input.evaluate((node) => {
    const element = node as HTMLInputElement
    element.setCustomValidity("")
    element.form!.reset()
  })
  await expect(alert).toHaveCount(0)
  await expect(input).not.toHaveAttribute("aria-invalid", "true")
})

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`login hierarchy and validation remain usable in ${colorScheme} at ${width}px`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width, height: 1000 })
      await page.goto("/login")
      const primary = page.getByRole("button", { name: "Sign in", exact: true })
      const sso = page.getByRole("link", { name: "Continue with SSO" })
      const forgot = page.getByRole("link", { name: "Forgot password?" })
      const create = page.getByRole("link", {
        name: "Create account",
        exact: true,
      })
      const verify = page.getByRole("link", {
        name: "Resend verification email",
      })
      for (const link of [sso, forgot, create, verify])
        await expect(link.locator("svg")).toHaveCount(1)
      expect(
        await primary.evaluate((e) => getComputedStyle(e).backgroundImage)
      ).not.toBe("none")
      expect(
        await sso.evaluate((e) => getComputedStyle(e).backgroundImage)
      ).toBe("none")
      expect(
        await create.evaluate((e) => getComputedStyle(e).backgroundColor)
      ).toBe("rgba(0, 0, 0, 0)")
      const passwordLabel = page.locator('label[for="password"]')
      const labelBox = await passwordLabel.boundingBox()
      const forgotBox = await forgot.boundingBox()
      expect(Math.abs(labelBox!.y - forgotBox!.y)).toBeLessThan(10)
      await page.getByLabel("Email", { exact: true }).fill("invalid@")
      await primary.click()
      await expect(page.locator('[data-slot="inline-toast"]')).toContainText(
        "Enter a valid email"
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(width)
      await page.screenshot({
        path: test.info().outputPath("login.png"),
        fullPage: true,
      })
      await forgot.click()
      await expect(
        page.getByRole("heading", { name: "Reset your password" })
      ).toBeVisible()
    })
  }
}
