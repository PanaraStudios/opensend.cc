import { test, expect, vi, afterEach } from "vitest"
import { connectClient } from "../helpers/client.js"
afterEach(() => vi.unstubAllGlobals())

test("media tools create and complete through the SDK without transferring binary data", async () => {
  const f = await connectClient()
  try {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "file",
        upload_url: "https://convex.test/upload",
        provider: "convex",
        expires_at: "2026-10-01T00:00:00Z",
      })
    )
    vi.stubGlobal("fetch", fetcher)
    await f.client.callTool({
      name: "create-media-upload",
      arguments: {
        use: "whatsapp",
        from: "phone",
        filename: "file.pdf",
        content_type: "application/pdf",
        size: 22020096,
      },
    })
    expect(fetcher.mock.calls[0][0]).toContain("/media/uploads")
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
      content_type: "application/pdf",
      size: 22020096,
    })
    await f.client.callTool({
      name: "complete-media-upload",
      arguments: { id: "file", storage_id: "storage" },
    })
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
      storage_id: "storage",
    })
    expect(fetcher.mock.calls[1][0]).toContain("/media/uploads/file/complete")
  } finally {
    await f.close()
  }
})
