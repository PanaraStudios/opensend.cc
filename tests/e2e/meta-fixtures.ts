import { expect, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import { client } from "./ses-fixtures"

export const WABA = "8830001"
export const PHONE_ID = `${WABA}0`
export const META_TOKEN = "EAAInboundE2EToken0123456789abcdef"

/** Connect through the real dashboard actions against the fake Graph server. */
export async function connectWhatsApp(page: Page, organizationId: string) {
  const backend = await client(page)
  const connected = await backend.action(
    api.meta.connectActions.connectManual,
    {
      organizationId,
      wabaId: WABA,
      token: META_TOKEN,
    }
  )
  const account = connected.accounts.find((account) => account.id)
  expect(account).toBeTruthy()
  if (!account!.registered)
    await backend.action(api.meta.connectActions.registerNumber, {
      accountId: account!.id,
      pin: "246810",
    })
  const calls = await (
    await page.request.get(`${process.env.OPENSEND_FAKE_GRAPH_URL}/__calls`)
  ).json()
  expect(calls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "GET",
        path: `/${WABA}/phone_numbers`,
        authorization: `Bearer ${META_TOKEN}`,
      }),
      expect.objectContaining({
        method: "POST",
        path: `/${WABA}/subscribed_apps`,
        authorization: `Bearer ${META_TOKEN}`,
      }),
    ])
  )
  if (!account!.registered)
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: `/${PHONE_ID}/register`,
          authorization: `Bearer ${META_TOKEN}`,
          body: { messaging_product: "whatsapp", pin: "246810" },
        }),
      ])
    )
  return account!.id
}
