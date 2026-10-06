import { expect, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"

/** The fresh-install flow chooses email without configuring Meta. Callback
 * proof uses the isolated suite's HTTP origin through the authenticated API,
 * as in its SES setup checks. This helper never seeds or replaces live data. */
export async function chooseEmailSetup(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Choose channels", exact: true })
  ).toBeVisible()
  const wizard = page.getByTestId("installation-wizard")
  const telemetry = wizard.getByRole("switch", {
    name: "Share anonymous usage statistics",
    exact: true,
  })
  await expect(telemetry).toBeVisible()
  await expect(telemetry).toBeEnabled()
  await expect(telemetry).toBeChecked()
  await wizard.getByRole("checkbox", { name: /Email/ }).check()
  await wizard.getByRole("checkbox", { name: /WhatsApp, Messenger/ }).uncheck()
  await page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/setup-channels-choice.png`,
    fullPage: true,
  })
  await wizard.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Public callback URL", exact: true })
  ).toBeVisible()
  const c = await client(page)
  const state = await c.query(api.installation.status)
  expect(state.installation?.channels).toEqual({ email: true, meta: false })
  if (!state.installation?.environmentCheckedAt)
    await expect(
      c.mutation(api.installation.navigate, { step: "aws" })
    ).rejects.toMatchObject({ data: "Check your public callback URL first" })
  await page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/setup-channels-callback.png`,
    fullPage: true,
  })
  await c.action(api.installationActions.checkEnvironment, {
    callbackOrigin: process.env.OPENSEND_CALLBACK_ORIGIN!,
  })
}
