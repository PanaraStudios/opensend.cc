import { playgroundShots } from "./playground-shots"
import { expect, test, type Page } from "@playwright/test"
import { connectWhatsApp } from "./meta-fixtures"
import { client } from "./ses-fixtures"
import { api } from "../../convex/_generated/api"
import { createApiKey } from "./broadcast-received-flow"
export function voiceBotTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("voice bot API configuration and write-only credentials", async () => {
    const { owner } = state(),
      origin = process.env.OPENSEND_CALLBACK_ORIGIN!
    const headers = await createApiKey(owner, "Voice bot E2E")
    const create = await owner.request.post(`${origin}/voice-providers`, {
      headers,
      data: {
        provider: "gemini",
        label: "E2E fixture",
        key: "fixture-key-not-a-live-provider",
      },
    })
    expect(create.status()).toBe(200)
    const credentialId = (await create.json()).id
    const botResponse = await owner.request.post(`${origin}/voice-bots`, {
      headers,
      data: {
        name: "E2E Support",
        engine: "gemini_live",
        provider: "gemini",
        credentialId,
        tools: ["lookup_contact", "create_note"],
      },
    })
    expect(botResponse.status()).toBe(200)
    const botId = (await botResponse.json()).id
    const providers = await owner.request.get(`${origin}/voice-providers`, {
      headers,
    })
    const credentials = await providers.json()
    expect(JSON.stringify(credentials)).not.toContain(
      "fixture-key-not-a-live-provider"
    )
    expect(
      credentials.data.find((item: { id: string }) => item.id === credentialId)
        .lastFour
    ).toBe("ider")
    const bot = await owner.request.get(`${origin}/voice-bots/${botId}`, {
      headers,
    })
    expect(await bot.json()).toMatchObject({
      engine: "gemini_live",
      credentialId,
      model: "gemini-3.8-live",
    })
    expect(
      (
        await owner.request.patch(`${origin}/voice-bots/${botId}`, {
          headers,
          data: { greeting: "How can I help?" },
        })
      ).status()
    ).toBe(200)
    expect(
      (
        await owner.request.delete(
          `${origin}/voice-providers/${credentialId}`,
          { headers }
        )
      ).status()
    ).toBe(409)
    // The API flow remains independent of browser media; dashboard coverage follows below.
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/voice-bot-api-config.png`,
      fullPage: true,
    })
    expect(
      (
        await owner.request.delete(`${origin}/voice-bots/${botId}`, { headers })
      ).status()
    ).toBe(200)
    expect(
      (
        await owner.request.delete(
          `${origin}/voice-providers/${credentialId}`,
          { headers }
        )
      ).status()
    ).toBe(200)
  })
  test("Playground voice bot uses create dialog, settings rail and Settings provider keys", async () => {
    const { owner, organizationId } = state()
    const accountId = await connectWhatsApp(owner, organizationId)
    const backend = await client(owner)
    await owner.goto("/settings/ai-providers")
    await owner
      .getByRole("button", { name: "Add provider key", exact: true })
      .click()
    const dialog = owner.getByRole("dialog", {
      name: "Add provider key",
      exact: true,
    })
    await dialog.getByLabel("Label", { exact: true }).fill("Playground Gemini")
    const secret = dialog.getByLabel("API key", { exact: true })
    await expect(secret).toHaveAttribute("autocomplete", "new-password")
    await expect(secret).toHaveAttribute("name", "service-secret")
    for (const attribute of [
      "data-1p-ignore",
      "data-lpignore",
      "data-bwignore",
    ])
      await expect(secret).toHaveAttribute(attribute, "true")
    await secret.fill("playground-e2e-provider-key-9876")
    await playgroundShots(owner, "playground-provider-create")
    await dialog.getByRole("button", { name: "Add", exact: true }).click()
    await expect(owner.getByText("••••9876", { exact: true })).toBeVisible()
    await playgroundShots(owner, "settings-ai-providers")
    await owner.goto("/playground/voice-bot")
    await playgroundShots(owner, "playground-bot-list-empty")
    await owner
      .getByRole("button", { name: "Create voice bot", exact: true })
      .first()
      .click()
    const create = owner.getByRole("dialog", {
      name: "Create voice bot",
      exact: true,
    })
    await create.getByLabel("Name", { exact: true }).fill("Browser support E2E")
    await expect(
      create.getByRole("combobox", { name: "Language", exact: true })
    ).toContainText("English")
    await expect(
      create.getByRole("radio", { name: /Gemini Live/ })
    ).toBeChecked()
    await playgroundShots(owner, "playground-bot-create")
    await create.getByRole("button", { name: "Create", exact: true }).click()
    await expect(owner).toHaveURL(/\/playground\/voice-bot\/[^/]+$/)
    const id = new URL(owner.url()).pathname.split("/").at(-1)!
    await expect(
      owner.getByRole("heading", {
        name: "Calling stack is not configured",
        exact: true,
      })
    ).toBeVisible()
    await expect(
      owner.getByRole("button", { name: "Start test call", exact: true })
    ).toBeDisabled()
    await expect(
      owner.getByRole("combobox", { name: "Voice", exact: true })
    ).toContainText("Kore")
    await owner
      .getByRole("switch", { name: "Enable Look up contact", exact: true })
      .check()
    await owner
      .getByLabel("Greeting", { exact: true })
      .fill("Updated browser greeting")
    await owner.getByRole("button", { name: "Save", exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await backend.query(api.voice.resources.dashboardGet, {
              organizationId,
              id,
            })
          ).greeting
      )
      .toBe("Updated browser greeting")
    const number = (
      await backend.query(api.calling.playgroundState.setup, { organizationId })
    ).numbers.find((n) => n.id === accountId)!
    await expect(
      owner
        .getByRole("checkbox", { name: `Route ${number.label}`, exact: true })
        .first()
    ).toBeDisabled()
    await owner
      .getByRole("combobox", { name: "Gemini key", exact: true })
      .click()
    await owner
      .getByRole("option", { name: "Add provider key…", exact: true })
      .click()
    await expect(
      owner.getByRole("dialog", { name: "Add provider key", exact: true })
    ).toBeVisible()
    await owner
      .getByRole("dialog", { name: "Add provider key", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click()
    await playgroundShots(owner, "playground-bot-not-configured")
    await owner.goto("/playground/voice-bot")
    await playgroundShots(owner, "playground-bot-list-filled")
    await owner
      .getByRole("link", { name: "Browser support E2E", exact: true })
      .click()
    await owner
      .getByRole("button", { name: "More options", exact: true })
      .click()
    await owner.getByRole("menuitem", { name: "Delete", exact: true }).click()
    await owner
      .getByRole("alertdialog")
      .getByRole("textbox")
      .fill("Browser support E2E")
    await owner
      .getByRole("button", { name: "Delete voice bot", exact: true })
      .click()
    await expect(owner).toHaveURL(/\/playground\/voice-bot$/)
    await owner.goto("/settings/ai-providers")
    await owner
      .getByRole("row")
      .filter({ hasText: "Playground Gemini" })
      .getByRole("button", { name: "More options", exact: true })
      .click()
    await owner.getByRole("menuitem", { name: "Delete", exact: true }).click()
    await owner
      .getByRole("alertdialog")
      .getByRole("textbox")
      .fill("Playground Gemini")
    await owner
      .getByRole("button", { name: "Delete provider key", exact: true })
      .click()
    await expect(owner.getByText("••••9876", { exact: true })).toHaveCount(0)
  })
}
