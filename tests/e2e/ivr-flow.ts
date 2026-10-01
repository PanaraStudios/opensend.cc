import { expect, test, type Page } from "@playwright/test"
import { createApiKey } from "./broadcast-received-flow"
export function ivrTests(state: () => { owner: Page; organizationId: string }) {
  test("IVR API creates, validates, updates and deletes a team menu tree", async () => {
    const { owner } = state(),
      origin = process.env.OPENSEND_CALLBACK_ORIGIN!,
      headers = await createApiKey(owner, "IVR E2E")
    const prompt = { kind: "tts", text: "Press one for support" }
    const hangup = { kind: "hangup" }
    const input = {
      name: "Reception E2E",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt,
          options: { "1": { kind: "submenu", menuId: "support" } },
          noInputAction: hangup,
          failureAction: hangup,
        },
        {
          id: "support",
          name: "Support",
          prompt,
          options: { "2": { kind: "voicemail" } },
          noInputAction: hangup,
          failureAction: hangup,
        },
      ],
    }
    const created = await owner.request.post(`${origin}/ivrs`, {
      headers: { ...headers, "idempotency-key": "ivr-e2e-create" },
      data: input,
    })
    expect(created.status()).toBe(201)
    const ivr = await created.json()
    expect(ivr.prompt_status).toBe("pending_render")
    const repeated = await owner.request.post(`${origin}/ivrs`, {
      headers: { ...headers, "idempotency-key": "ivr-e2e-create" },
      data: input,
    })
    expect((await repeated.json()).id).toBe(ivr.id)
    const list = await owner.request.get(`${origin}/ivrs?limit=100`, {
      headers,
    })
    expect(
      (await list.json()).data.some((r: { id: string }) => r.id === ivr.id)
    ).toBe(true)
    const invalid = await owner.request.post(
      `${origin}/ivrs/${ivr.id}/validate`,
      { headers, data: { entryMenuId: "missing" } }
    )
    expect((await invalid.json()).valid).toBe(false)
    const updated = await owner.request.patch(`${origin}/ivrs/${ivr.id}`, {
      headers,
      data: { name: "Reception updated" },
    })
    expect((await updated.json()).name).toBe("Reception updated")
    const valid = await owner.request.post(
      `${origin}/ivrs/${ivr.id}/validate`,
      { headers, data: {} }
    )
    expect(await valid.json()).toEqual({ valid: true, errors: [] })
    await owner.goto("/channels")
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/ivr-api-flow.png`,
      fullPage: true,
    })
    expect(
      (
        await owner.request.delete(`${origin}/ivrs/${ivr.id}`, { headers })
      ).status()
    ).toBe(200)
    expect(
      (
        await owner.request.get(`${origin}/ivrs/${ivr.id}`, { headers })
      ).status()
    ).toBe(404)
  })
}
