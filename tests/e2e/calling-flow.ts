import { CALLING_TEST_SDP as SDP } from "../../lib/meta/calling-fixtures"
import { createHmac } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { connectWhatsApp, WABA, PHONE_ID } from "./meta-fixtures"
import { createApiKey } from "./broadcast-received-flow"
const APP_SECRET = "e2e0123456789abcdef0123456789abc"
const BSUID = "US.13491208655302741918"
export function callingTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("calling settings, signed UIC lifecycle, API SDP actions, permissions and dashboard log", async () => {
    const { owner, organizationId } = state(),
      origin = process.env.OPENSEND_CALLBACK_ORIGIN!,
      fake = process.env.OPENSEND_FAKE_GRAPH_URL!
    const accountId = await connectWhatsApp(owner, organizationId)
    const headers = await createApiKey(owner, "Calling E2E")
    await owner.goto(`/channels/${accountId}`)
    await owner
      .getByRole("button", { name: "Refresh settings", exact: true })
      .click()
    await owner
      .getByRole("combobox", { name: "Calling status", exact: true })
      .click()
    await owner.getByRole("option", { name: "Enabled", exact: true }).click()
    await owner
      .getByRole("combobox", { name: "Call handling", exact: true })
      .click()
    await owner
      .getByRole("option", { name: "Your calling integration", exact: true })
      .click()
    await owner
      .getByRole("button", { name: "Save calling settings", exact: true })
      .click()
    await expect(
      owner.getByRole("button", { name: "Save calling settings", exact: true })
    ).toBeDisabled()
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/calling-settings.png`,
      fullPage: true,
    })
    const settings = await owner.request.get(
      `${origin}/whatsapp/phone-numbers/${PHONE_ID}/calling`,
      { headers }
    )
    expect(settings.status()).toBe(200)
    expect(await settings.json()).toMatchObject({
      handling_mode: "api",
      calling: { status: "ENABLED" },
    })
    const webhook = async (
      calls: unknown[],
      field = "calls",
      messages?: unknown[]
    ) => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: WABA,
            changes: [
              {
                field,
                value: {
                  metadata: { phone_number_id: PHONE_ID },
                  contacts: [
                    { user_id: BSUID, profile: { name: "Calling E2E" } },
                  ],
                  calls,
                  ...(messages ? { messages } : {}),
                },
              },
            ],
          },
        ],
      })
      const result = await owner.request.post(`${origin}/meta/webhook`, {
        data: body,
        headers: {
          "content-type": "application/json",
          "X-Hub-Signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
        },
      })
      expect(result.status()).toBe(200)
    }
    const now = Math.floor(Date.now() / 1000),
      wacid = `wacid.uic.e2e.${now}`
    const offer = {
      id: wacid,
      from_user_id: BSUID,
      event: "connect",
      direction: "USER_INITIATED",
      timestamp: String(now),
      session: { sdp_type: "offer", sdp: SDP },
      cta_payload: "CRM-support",
    }
    await webhook([offer])
    await webhook([offer])
    let id = ""
    await expect
      .poll(async () => {
        const list = await (
          await owner.request.get(
            `${origin}/whatsapp/calls?phone_number_id=${PHONE_ID}`,
            { headers }
          )
        ).json()
        const call = list.data.find((c: { wacid: string }) => c.wacid === wacid)
        id = call?.id ?? ""
        return call?.status
      })
      .toBe("ringing")
    for (const action of ["pre_accept", "accept", "terminate"]) {
      const result = await owner.request.post(
        `${origin}/whatsapp/calls/${id}/${action}`,
        {
          headers,
          data:
            action === "terminate"
              ? {}
              : { session: { sdp_type: "answer", sdp: SDP } },
        }
      )
      expect(result.status()).toBe(200)
    }
    await webhook([
      {
        id: wacid,
        from_user_id: BSUID,
        event: "terminate",
        direction: "USER_INITIATED",
        timestamp: String(now + 38),
        status: ["COMPLETED"],
        start_time: String(now),
        end_time: String(now + 38),
        duration: 38,
      },
    ])
    await expect
      .poll(
        async () =>
          (
            await (
              await owner.request.get(`${origin}/whatsapp/calls/${id}`, {
                headers,
              })
            ).json()
          ).duration
      )
      .toBe(38)
    await webhook([], "messages", [
      {
        id: `wamid.permission.${now}`,
        type: "interactive",
        from_user_id: BSUID,
        timestamp: String(now + 39),
        interactive: {
          type: "call_permission_reply",
          call_permission_reply: {
            response: "accept",
            is_permanent: true,
            response_source: "user_action",
          },
        },
      },
    ])
    const permissions = await owner.request.get(
      `${origin}/whatsapp/call-permissions?from=${PHONE_ID}&recipient=${BSUID}`,
      { headers }
    )
    expect(permissions.status()).toBe(200)
    expect((await permissions.json()).permission.status).toBe("permanent")
    const permissionRequest = await owner.request.post(
      `${origin}/whatsapp/call-permissions`,
      {
        headers,
        data: {
          from: PHONE_ID,
          recipient: BSUID,
          text: "May we call about your support request?",
        },
      }
    )
    expect(permissionRequest.status()).toBe(200)
    const permissionMessage = await permissionRequest.json()
    await expect
      .poll(
        async () =>
          (
            await (
              await owner.request.get(
                `${origin}/whatsapp/messages/${permissionMessage.id}`,
                { headers }
              )
            ).json()
          ).status
      )
      .toBe("sent")
    const outbound = await owner.request.post(`${origin}/whatsapp/calls`, {
      headers: { ...headers, "Idempotency-Key": `calling-${now}` },
      data: {
        from: PHONE_ID,
        recipient: BSUID,
        route: "api",
        session: { sdp_type: "offer", sdp: SDP },
      },
    })
    expect(outbound.status()).toBe(200)
    const created = await outbound.json()
    expect(
      (
        await owner.request.post(
          `${origin}/whatsapp/calls/${created.id}/terminate`,
          { headers, data: {} }
        )
      ).status()
    ).toBe(200)
    await expect(
      owner.getByRole("heading", { name: "Call log", exact: true })
    ).toBeVisible()
    await expect(owner.getByText("38s", { exact: true })).toBeVisible()
    await owner.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/calling-log.png`,
      fullPage: true,
    })
    const graphCalls = await (await owner.request.get(`${fake}/__calls`)).json()
    expect(graphCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `/${PHONE_ID}/calls`,
          body: {
            messaging_product: "whatsapp",
            action: "pre_accept",
            call_id: wacid,
            session: { sdp_type: "answer", sdp: SDP },
          },
        }),
        expect.objectContaining({
          path: `/${PHONE_ID}/call_permissions`,
          query: { recipient: BSUID },
        }),
      ])
    )
  })
}
