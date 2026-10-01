import { expect, test, type Page } from "@playwright/test"
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
    // Dashboard editors and microphone testing arrive in 8d-4; preserve the current API-key screen.
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
}
