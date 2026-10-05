import { afterEach, expect, it, vi } from "vitest"
import { Opensend } from "../resend"
import type { IvrDefinition } from "./interfaces"
afterEach(() => {
  vi.unstubAllGlobals()
})
it("IVR CRUD and validation use stable encoded paths, cursor parameters and idempotency", async () => {
  const fetcher = vi.fn(async () => Response.json({ id: "ivr" }))
  vi.stubGlobal("fetch", fetcher)
  const client = new Opensend("os_test", {
    baseUrl: "https://api.example.test",
  })
  const input: IvrDefinition = {
    name: "Main",
    language: "en",
    entryMenuId: "main",
    menus: [
      {
        id: "main",
        name: "Main",
        prompt: { kind: "audio", fileId: "file" },
        timeoutSeconds: 5,
        retries: 2,
        maxDigits: 1,
        options: { "1": { kind: "voicemail" } },
        noInputAction: { kind: "hangup" },
        failureAction: { kind: "hangup" },
      },
    ],
  }
  await client.ivrs.create(input, { idempotencyKey: "once" })
  expect(
    new Headers(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers
    ).get("idempotency-key")
  ).toBe("once")
  await client.ivrs.list({ limit: 10, after: "cursor" })
  await client.ivrs.get("ivr/1")
  await client.ivrs.update("ivr/1", { name: "Updated" })
  await client.ivrs.remove("ivr/1")
  await client.ivrs.validate("ivr/1", { entryMenuId: "bad" })
  await client.ivrs.render("ivr/1")
  await client.ivrs.rotateSigningSecret("ivr/1", {
    idempotencyKey: "rotate-once",
  })
  expect(fetcher.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
    "https://api.example.test/ivrs",
    "https://api.example.test/ivrs?limit=10&after=cursor",
    ...["", "", "", "/validate", "/render", "/rotate-signing-secret"].map(
      (p) => `https://api.example.test/ivrs/ivr%2F1${p}`
    ),
  ])
  expect(
    fetcher.mock.calls.map(
      (c) => (c as unknown as [string, RequestInit])[1].method
    )
  ).toEqual(["POST", "GET", "GET", "PATCH", "DELETE", "POST", "POST", "POST"])
  await client.whatsapp.phoneNumbers.updateCalling("number", {
    routing: { kind: "ivr", ivrId: "ivr" },
  })
  expect(
    JSON.parse(
      (fetcher.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
        .body as string
    )
  ).toEqual({ routing: { kind: "ivr", ivrId: "ivr" } })
})
