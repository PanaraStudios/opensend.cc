import { expect, test, type Page } from "@playwright/test"
import { playgroundShots } from "./playground-shots"
import { client } from "./ses-fixtures"
import { api } from "../../convex/_generated/api"
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
  test("Playground IVR creates two menus in a flow, validates and shows the unavailable tester", async () => {
    const { owner, organizationId } = state()
    await owner.goto("/playground/ivr")
    await playgroundShots(owner, "playground-ivr-list-empty")
    await owner
      .getByRole("button", { name: "Create IVR", exact: true })
      .first()
      .click()
    const create = owner.getByRole("dialog", {
      name: "Create IVR",
      exact: true,
    })
    await create
      .getByLabel("Name", { exact: true })
      .fill("Playground reception")
    await expect(
      create.getByRole("combobox", { name: "Language", exact: true })
    ).toContainText("English")
    await create
      .getByRole("combobox", { name: "Prompt provider", exact: true })
      .click()
    await owner
      .getByRole("option", { name: "Sarvam Bulbul v3", exact: true })
      .click()
    await expect(
      create.getByRole("combobox", { name: "Prompt voice", exact: true })
    ).toContainText("Shubh")
    await create
      .getByRole("combobox", { name: "Prompt provider", exact: true })
      .click()
    await owner
      .getByRole("option", { name: "Upload audio instead", exact: true })
      .click()
    await playgroundShots(owner, "playground-ivr-create")
    await create.getByRole("button", { name: "Create", exact: true }).click()
    await expect(owner).toHaveURL(/\/playground\/ivr\/[^/]+$/)
    await expect(owner.getByLabel("Menu ID", { exact: true })).toHaveCount(0)
    await owner
      .getByLabel("Prompt text", { exact: true })
      .fill("Press one for support")
    const main = owner.getByTestId("workflow-node-menu:main")
    await main
      .getByRole("button", { name: "Add option · Press 1", exact: true })
      .click()
    await owner.getByRole("menuitem", { name: "New menu", exact: true }).click()
    await owner.getByLabel("Menu name", { exact: true }).fill("Support")
    await owner
      .getByLabel("Prompt text", { exact: true })
      .fill("Leave a message")
    await expect(
      owner.getByText("Press 1", { exact: true }).first()
    ).toBeVisible()
    await expect(
      owner.getByRole("button", { name: "Support", exact: true })
    ).toHaveCount(1)
    await owner.getByRole("button", { name: "Support", exact: true }).click()
    const editor = owner.getByRole("complementary", {
      name: "Flow editor",
      exact: true,
    })
    const support = owner
      .locator('[data-testid^="workflow-node-menu:"]')
      .filter({
        has: owner.getByRole("button", { name: "Support", exact: true }),
      })
    await support
      .getByRole("button", { name: "Add option · Press 1", exact: true })
      .click()
    await owner
      .getByRole("menuitem", { name: "Go to menu", exact: true })
      .click()
    await editor.getByRole("combobox", { name: "Submenu", exact: true }).click()
    await owner.getByRole("option", { name: "Main", exact: true }).click()
    const loop = owner.getByRole("button", { name: "Go to Main", exact: true })
    await expect(loop).toHaveCount(1)
    await loop.click()
    await expect(editor.getByLabel("Menu name", { exact: true })).toHaveValue(
      "Main"
    )
    await owner.getByRole("button", { name: "Support", exact: true }).click()
    await editor
      .getByRole("button", { name: "Remove menu", exact: true })
      .click()
    const removal = owner.getByRole("alertdialog", {
      name: "Remove menu",
      exact: true,
    })
    await expect(removal).toContainText("Main · Press 1")
    await removal.getByRole("button", { name: "Cancel", exact: true }).click()
    await owner.getByRole("button", { name: "Validate", exact: true }).click()
    await expect(owner.getByText("IVR is valid", { exact: true })).toBeVisible()
    await owner.getByRole("button", { name: "Save", exact: true }).click()
    await expect(
      owner.getByText("Needs a voice", { exact: true }).first()
    ).toBeVisible()
    await playgroundShots(owner, "playground-ivr-flow-two-menus")
    await owner.getByRole("button", { name: "Support", exact: true }).click()
    await playgroundShots(owner, "playground-ivr-menu-selected")
    await owner
      .getByRole("button", { name: "Hang up", exact: true })
      .first()
      .click()
    await playgroundShots(owner, "playground-ivr-destination-selected")
    const viewport = owner.viewportSize()
    await owner.setViewportSize({ width: 390, height: 960 })
    const mobileEditor = owner.getByRole("dialog", {
      name: "Edit call flow",
      exact: true,
    })
    await mobileEditor
      .getByRole("button", { name: "Close", exact: true })
      .click()
    await expect(owner.getByTestId("workflow")).toBeVisible()
    await expect
      .poll(() =>
        owner.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true)
    await owner.getByRole("button", { name: "Go to Main", exact: true }).click()
    await expect(
      mobileEditor.getByLabel("Menu name", { exact: true })
    ).toHaveValue("Main")
    await mobileEditor
      .getByRole("button", { name: "Close", exact: true })
      .click()
    if (viewport) await owner.setViewportSize(viewport)
    await owner.getByRole("button", { name: "Test IVR", exact: true }).click()
    const tester = owner.getByRole("dialog", { name: "Test IVR", exact: true })
    const backend = await client(owner)
    // The runner omits the calling profile and all calling environment variables.
    // Missing setup must show the heading immediately, without starting a health probe.
    expect(
      (
        await backend.query(api.calling.playgroundState.setup, {
          organizationId,
        })
      ).configured
    ).toBe(false)
    expect(
      await backend.action(api.calling.playground.health, { organizationId })
    ).toBe(false)
    await expect(
      tester.getByRole("heading", {
        name: "Calling stack is not configured",
        exact: true,
      })
    ).toBeVisible()
    await expect(
      tester.getByRole("button", { name: "Start test call", exact: true })
    ).toBeDisabled()
    await expect(
      tester.getByRole("button", { name: "Send 1", exact: true })
    ).toBeDisabled()
    await expect(owner.getByText(/pending_render/)).toHaveCount(0)
    await playgroundShots(owner, "playground-ivr-tester")
    await tester.getByRole("button", { name: "Close", exact: true }).click()
    await owner
      .getByRole("button", { name: "More options", exact: true })
      .click()
    await owner.getByRole("menuitem", { name: "Delete", exact: true }).click()
    await owner
      .getByRole("alertdialog")
      .getByRole("textbox")
      .fill("Playground reception")
    await owner.getByRole("button", { name: "Delete IVR", exact: true }).click()
    await expect(owner).toHaveURL(/\/playground\/ivr$/)
  })
}
