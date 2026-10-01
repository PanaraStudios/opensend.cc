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
  test("Playground voice bot CRUD and masked provider keys use the shared editor and unconfigured tester", async () => {
    const { owner, organizationId } = state()
    const accountId = await connectWhatsApp(owner, organizationId)
    await owner.goto("/playground/voice-bot")
    await owner.getByLabel("Label", { exact: true }).fill("Playground Gemini")
    await owner
      .getByLabel("API key", { exact: true })
      .fill("playground-e2e-provider-key-9876")
    await owner
      .getByRole("button", { name: "Add provider key", exact: true })
      .click()
    await expect(owner.getByText("••••9876", { exact: true })).toBeVisible()
    await expect(owner.getByLabel("API key", { exact: true })).toHaveValue("")
    await owner
      .getByRole("button", { name: "Create voice bot", exact: true })
      .first()
      .click()
    await owner.getByLabel("Name", { exact: true }).fill("Browser support E2E")
    await owner
      .getByRole("combobox", { name: "Primary provider key", exact: true })
      .click()
    await owner
      .getByRole("option", {
        name: "Playground Gemini · ••••9876",
        exact: true,
      })
      .click()
    await owner.getByLabel("Enable lookup_contact", { exact: true }).check()
    await owner.getByRole("button", { name: "Save", exact: true }).click()
    await expect(owner).toHaveURL(/\/playground\/voice-bot\/[^/]+$/)
    const id = new URL(owner.url()).pathname.split("/").at(-1)!
    await expect(
      owner.getByRole("heading", {
        name: "Calling stack is not configured",
        exact: true,
      })
    ).toBeVisible()
    await owner
      .getByLabel("Greeting", { exact: true })
      .fill("Updated browser greeting")
    await owner.getByRole("button", { name: "Save", exact: true }).click()
    const backend = await client(owner)
    const routing = owner
      .locator("section")
      .filter({
        has: owner.getByRole("heading", { name: "Routing", exact: true }),
      })
    const assign = routing
      .getByRole("button", { name: "Assign", exact: true })
      .first()
    await expect(assign).toBeVisible()
    if (await assign.isEnabled()) {
      await assign.click()
      await expect
        .poll(
          async () =>
            (
              await backend.query(api.calling.playgroundState.setup, {
                organizationId,
              })
            ).numbers.find((n) => n.id === accountId)?.routing
        )
        .toBe(`bot:${id}`)
      await routing
        .getByRole("button", { name: "Unassign", exact: true })
        .click()
      await expect
        .poll(
          async () =>
            (
              await backend.query(api.calling.playgroundState.setup, {
                organizationId,
              })
            ).numbers.find((n) => n.id === accountId)?.routing
        )
        .toBe("agents")
    } else await expect(assign).toBeDisabled()
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
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/playground-voice-bot-editor.png`,
      fullPage: true,
    })
    await owner.getByRole("button", { name: "Delete", exact: true }).click()
    await owner
      .getByRole("alertdialog")
      .getByRole("textbox")
      .fill("Browser support E2E")
    await owner
      .getByRole("button", { name: "Delete voice bot", exact: true })
      .click()
    await expect(owner).toHaveURL(/\/playground\/voice-bot$/)
    await owner
      .getByRole("button", {
        name: "Delete key Playground Gemini",
        exact: true,
      })
      .click()
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
