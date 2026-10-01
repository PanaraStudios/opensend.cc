import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"

type State = { owner: Page; member: Page }
/** A request tests/e2e/fake-graph.mjs recorded. */
type GraphCall = {
  method: string
  version: string
  path: string
  query: Record<string, string>
  body?: unknown
  authorization?: string
}

/* fake-graph.mjs gives every WABA one number, `${waba}0`, displayed as
   +1 555-XXXX from its last digits, and names WABAs "Opensend E2E". */
const WABA = "8820001"
const PHONE = `${WABA}0`
const HANDLE = "+1 555-0001"
const OTHER_WABA = "8820002"
const TOKEN = "EAAE2ESystemUserToken0123456789"
const PIN = "246810"
/** The WhatsApp brand mark's path, from components/brand-icons.tsx. */
const WHATSAPP_MARK = /^M17\.472 14\.382/

const fakeGraph = () => process.env.OPENSEND_FAKE_GRAPH_URL!
const screenshot = (page: Page, name: string) =>
  page.screenshot({
    path: `${process.env.OPENSEND_TEST_RESULTS}/channels-${name}.png`,
    fullPage: true,
  })
async function graphCalls(page: Page): Promise<GraphCall[]> {
  return (await page.request.get(`${fakeGraph()}/__calls`)).json()
}
const callsTo = async (page: Page, method: string, path: string) =>
  (await graphCalls(page)).filter(
    (call) => call.method === method && call.path === path
  )

/** Runs after metaAppTests, which leaves the Meta app saved with a WhatsApp
    Embedded Signup configuration ID. */
export function channelsTests(state: () => State) {
  test("the owner connects a WhatsApp number manually, registers, syncs and disconnects it", async () => {
    const { owner } = state()
    await owner.request.post(`${fakeGraph()}/__reset`)
    await owner.goto("/channels")
    await expect(
      owner.getByRole("heading", { name: "Channels", level: 1 })
    ).toBeVisible()
    await expect(owner.getByText("No channels", { exact: true })).toBeVisible()
    await expect(
      owner.getByRole("button", { name: "Connect with Meta" }).first()
    ).toBeVisible()
    await screenshot(owner, "empty")

    // Connect manually with a WABA ID and a system-user token.
    await owner
      .getByRole("button", { name: "Connect manually", exact: true })
      .first()
      .click()
    const manual = owner.getByRole("dialog", { name: "Connect manually" })
    await manual
      .getByLabel("WhatsApp Business Account ID", { exact: true })
      .fill(WABA)
    await manual
      .getByLabel("System user access token", { exact: true })
      .fill(TOKEN)
    await screenshot(owner, "manual")
    await manual.getByRole("button", { name: "Connect", exact: true }).click()
    await expect(manual).toHaveCount(0)
    await expect(
      owner.getByText("WhatsApp connected", { exact: true })
    ).toBeVisible()
    // The PIN dialog opens for the new number; register it later.
    const pinDialog = owner.getByRole("dialog", { name: "Register number" })
    await expect(pinDialog).toContainText(HANDLE)
    await pinDialog.getByRole("button", { name: "Later", exact: true }).click()
    await expect(pinDialog).toHaveCount(0)

    const row = owner.getByRole("row").filter({ hasText: HANDLE })
    await expect(row).toContainText("Opensend E2E")
    await expect(row).toContainText("Pending")
    await expect(row).toContainText("Green")
    await expect(row.locator("svg path").first()).toHaveAttribute(
      "d",
      WHATSAPP_MARK
    )
    const subscribed = await callsTo(owner, "POST", `/${WABA}/subscribed_apps`)
    expect(subscribed).toEqual([
      expect.objectContaining({
        version: "v25.0",
        authorization: `Bearer ${TOKEN}`,
      }),
    ])
    expect((await callsTo(owner, "GET", "/debug_token"))[0].query).toEqual({
      input_token: TOKEN,
    })
    await screenshot(owner, "pending")

    // Register the number with its PIN.
    await owner.request.post(`${fakeGraph()}/__reset`)
    await row.getByRole("button", { name: "More options" }).click()
    await owner.getByRole("menuitem", { name: "Register number" }).click()
    await pinDialog
      .getByLabel("Two-step verification PIN", { exact: true })
      .fill(PIN)
    await screenshot(owner, "pin")
    await pinDialog
      .getByRole("button", { name: "Register", exact: true })
      .click()
    await expect(pinDialog).toHaveCount(0)
    await expect(row).toContainText("Active")
    expect(await callsTo(owner, "POST", `/${PHONE}/register`)).toEqual([
      expect.objectContaining({
        body: { messaging_product: "whatsapp", pin: PIN },
        authorization: `Bearer ${TOKEN}`,
      }),
    ])

    // The detail page shows the number's standing with Meta.
    await row.getByRole("link", { name: "Opensend E2E" }).click()
    await expect(
      owner.getByRole("heading", { name: "Opensend E2E", level: 1 })
    ).toBeVisible()
    for (const text of [
      "Active",
      "Green",
      "80 messages/s",
      "1K per 24 hours",
      PHONE,
    ])
      await expect(owner.getByText(text, { exact: true }).first()).toBeVisible()
    await screenshot(owner, "detail")

    // Sync reads the number again.
    await owner.request.post(`${fakeGraph()}/__reset`)
    await owner.getByRole("button", { name: "Sync", exact: true }).click()
    await expect(
      owner.getByText("Number synced", { exact: true })
    ).toBeVisible()
    const synced = await callsTo(owner, "GET", `/${PHONE}`)
    expect(synced).toHaveLength(1)
    expect(synced[0].query.fields).toContain("throughput")

    // Another team cannot take the WABA; Embedded Signup's exchange works
    // for a WABA of its own.
    const backend = await client(owner)
    const activeTeam = (await backend.query(api.teams.snapshot))!.activeTeamId!
    const otherTeam = await backend.mutation(api.teams.create, {
      name: "Channels fixture",
    })
    await backend.mutation(api.teams.switchTeam, {
      organizationId: activeTeam,
    })
    await expect(
      backend.action(api.meta.connectActions.connectManual, {
        organizationId: otherTeam,
        token: TOKEN,
        wabaId: WABA,
      })
    ).rejects.toMatchObject({
      // Production backends redact the message; ConvexError data carries it.
      data: "This WhatsApp Business Account is already connected to another team",
    })
    await owner.request.post(`${fakeGraph()}/__reset`)
    const exchanged = await backend.action(
      api.meta.connectActions.exchangeEmbeddedSignup,
      {
        organizationId: otherTeam,
        code: "e2e-signup-code",
        wabaId: OTHER_WABA,
        businessId: "8829999",
        phoneNumberId: `${OTHER_WABA}0`,
      }
    )
    expect(exchanged.accounts).toEqual([
      expect.objectContaining({ registered: false }),
    ])
    expect(
      (await callsTo(owner, "GET", "/oauth/access_token"))[0].query
    ).toMatchObject({ code: "e2e-signup-code" })
    await backend.mutation(api.meta.connect.disconnect, {
      connectionId: exchanged.connectionId,
    })
    await backend.mutation(api.teams.remove, {
      organizationId: otherTeam,
      leave: false,
    })

    // Disconnecting the business removes its number from the list.
    await owner.request.post(`${fakeGraph()}/__reset`)
    await owner.goto("/channels")
    await row.getByRole("button", { name: "More options" }).click()
    await owner.getByRole("menuitem", { name: "Disconnect business" }).click()
    const confirm = owner.getByRole("alertdialog")
    await confirm.getByRole("textbox").fill("Opensend E2E")
    await screenshot(owner, "disconnect")
    await confirm.getByRole("button", { name: /^Disconnect/ }).click()
    await expect(row).toHaveCount(0)
    await expect(owner.getByText("No channels", { exact: true })).toBeVisible()
    await expect
      .poll(
        async () =>
          (await callsTo(owner, "DELETE", `/${WABA}/subscribed_apps`)).length
      )
      .toBe(1)
  })

  test("Connect with Meta waits for the administrator's Embedded Signup setup", async () => {
    const { owner, member } = state()
    const backend = await client(owner)
    const status = await backend.query(api.meta.app.status, {})
    const save = (whatsapp?: string) =>
      backend.action(api.meta.app.save, {
        appId: status.appId!,
        graphVersion: status.graphVersion,
        configIds: { ...status.configIds, whatsapp, facebookLogin: undefined },
      })
    await save(undefined)
    try {
      await owner.goto("/channels")
      await expect(
        owner.getByText("Embedded Signup is not set up", { exact: true })
      ).toBeVisible()
      await expect(
        owner.getByRole("button", { name: "Connect with Meta" }).first()
      ).toBeDisabled()
      await expect(
        owner.getByText("Facebook Login for Business is not set up", {
          exact: true,
        })
      ).toBeVisible()
      await owner
        .getByRole("button", { name: "Connect channel", exact: true })
        .first()
        .click()
      await expect(
        owner.getByRole("menuitem", {
          name: "Facebook Page & Instagram",
          exact: true,
        })
      ).toBeDisabled()
      await screenshot(owner, "connect-menu")
      await owner.keyboard.press("Escape")
      // The administrator gets a way to fix it; a member does not.
      await expect(
        owner.getByRole("link", { name: "Set up the Meta app" }).first()
      ).toHaveAttribute("href", "/instance/meta")
      await screenshot(owner, "no-signup-config")
      await member.goto("/channels")
      await expect(
        member.getByText("Embedded Signup is not set up", { exact: true })
      ).toBeVisible()
      await expect(
        member.getByRole("link", { name: "Set up the Meta app" })
      ).toHaveCount(0)
      await screenshot(member, "member")
    } finally {
      await backend.action(api.meta.app.save, {
        appId: status.appId!,
        graphVersion: status.graphVersion,
        configIds: status.configIds,
      })
    }
  })
}
