import { afterEach, expect, it, vi } from "vitest"
import { connectClient, baseUrl } from "../helpers/client.js"
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("IVR signing-secret rotation forwards retries and reveals the write response", async () => {
  const f = await connectClient()
  try {
    const tools = (await f.client.listTools()).tools
    expect(
      tools.find((t) => t.name === "rotate-ivr-signing-secret")!.annotations
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    })
    const rotated = { id: "ivr/1", webhookSecret: "fixture-rotated-secret" }
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(rotated)
    )
    vi.stubGlobal("fetch", fetcher)
    const result = await f.client.callTool({
      name: "rotate-ivr-signing-secret",
      arguments: { id: "ivr/1", idempotencyKey: "rotation-retry" },
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual(rotated)
    expect(JSON.stringify(result.content)).toContain(rotated.webhookSecret)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`${baseUrl}/ivrs/ivr%2F1/rotate-signing-secret`)
    expect(init?.method).toBe("POST")
    expect(JSON.parse(init?.body as string)).toEqual({})
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "rotation-retry"
    )
    const count = fetcher.mock.calls.length
    expect(
      (
        await f.client.callTool({
          name: "rotate-ivr-signing-secret",
          arguments: { id: 123 },
        })
      ).isError
    ).toBe(true)
    expect(fetcher.mock.calls).toHaveLength(count)
  } finally {
    await f.close()
  }
})
it("IVR tools expose CRUD, validation, routing and reject malformed inputs before requests", async () => {
  const f = await connectClient()
  try {
    const tools = (await f.client.listTools()).tools
    expect(
      tools.find((t) => t.name === "validate-ivr")!.annotations!.readOnlyHint
    ).toBe(true)
    expect(
      tools.find((t) => t.name === "remove-ivr")!.annotations!.destructiveHint
    ).toBe(true)
    const fetcher = vi.fn(async () => Response.json({ id: "ivr" }))
    vi.stubGlobal("fetch", fetcher)
    const input = {
      name: "Main",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt: { kind: "audio", fileId: "file" },
          options: { "1": { kind: "voicemail" } },
          noInputAction: { kind: "hangup" },
          failureAction: { kind: "hangup" },
        },
      ],
    }
    expect(
      (
        await f.client.callTool({
          name: "create-ivr",
          arguments: { ...input, idempotencyKey: "once" },
        })
      ).isError
    ).not.toBe(true)
    expect(
      new Headers(
        (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers
      ).get("idempotency-key")
    ).toBe("once")
    for (const name of [
      "get-ivr",
      "update-ivr",
      "remove-ivr",
      "validate-ivr",
      "render-ivr",
    ])
      expect(
        (
          await f.client.callTool({
            name,
            arguments: {
              id: "ivr/1",
              ...(name === "update-ivr" ? { name: "Updated" } : {}),
            },
          })
        ).isError
      ).not.toBe(true)
    expect(
      (await f.client.callTool({ name: "list-ivrs", arguments: { limit: 10 } }))
        .isError
    ).not.toBe(true)
    const count = fetcher.mock.calls.length
    expect(
      (
        await f.client.callTool({
          name: "create-ivr",
          arguments: { ...input, menus: [] },
        })
      ).isError
    ).toBe(true)
    expect(
      (
        await f.client.callTool({
          name: "list-ivrs",
          arguments: { after: "a", before: "b" },
        })
      ).isError
    ).toBe(true)
    expect(fetcher.mock.calls).toHaveLength(count)
    expect(
      (
        await f.client.callTool({
          name: "update-whatsapp-calling",
          arguments: { id: "number", routing: { kind: "ivr", ivrId: "ivr" } },
        })
      ).isError
    ).not.toBe(true)
    expect(
      JSON.parse(
        (fetcher.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
          .body as string
      )
    ).toEqual({ routing: { kind: "ivr", ivrId: "ivr" } })
  } finally {
    await f.close()
  }
})
