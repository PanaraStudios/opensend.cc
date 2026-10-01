import { mediaDownloadLink } from "./channels/downloads"
import { storeUpload } from "./testHelpers/storage.fixture"
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import {
  inboundFixture,
  fakeGraph,
  incoming,
  signedWebhook,
  APP_SECRET,
  PHONE_ID,
  SENDER,
  envelope,
} from "./testHelpers/meta.fixture"
import { patchRow } from "./counts"
import type { Id } from "./_generated/dataModel"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "storage-test-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "storage-test-download-secret")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, incoming()))
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
  return f
}
async function pending(
  f: Awaited<ReturnType<typeof setup>>,
  size = 3,
  type = "image/png"
) {
  return f.owner.client.action(api.storage.objects.createUpload, {
    organizationId: f.owner.team,
    input: {
      use: "whatsapp",
      from: f.account,
      filename: "file",
      size,
      contentType: type,
    },
  })
}
async function uploaded(
  f: Awaited<ReturnType<typeof setup>>,
  p: Awaited<ReturnType<typeof pending>>,
  bytes: Blob
) {
  // The fixture models the system metadata created by a direct upload.
  const storageId = await storeUpload(f.t, bytes)
  await f.owner.client.action(api.storage.objects.completeUpload, {
    organizationId: f.owner.team,
    id: p.id,
    storageId,
  })
  return storageId
}

test("Convex direct uploads over 20 MB complete and send through Meta media upload", async () => {
  const f = await setup()
  const size = 21 * 1024 * 1024
  const p = await pending(f, size, "application/pdf")
  expect(p.provider).toBe("convex")
  expect(p.upload_url).not.toContain("storage-upload")
  const storageId = await uploaded(
    f,
    p,
    new Blob([new Uint8Array(size)], { type: "application/pdf" })
  )
  await expect(
    f.outsider.client.action(api.storage.objects.completeUpload, {
      organizationId: f.outsider.team,
      id: p.id,
      storageId,
    })
  ).rejects.toBeTruthy()
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/media`,
      respond: () => ({ id: "meta-upload" }),
    },
    {
      method: "POST",
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.convex" }] }),
    },
  ])
  const thread = await f.t.run((ctx) => ctx.db.query("conversations").first())
  const id = await f.owner.client.mutation(api.conversations.reply, {
    id: thread!._id,
    fileId: p.id,
    text: "Document",
  })
  await f.t.action(internal.channels.deliver.deliver, {
    id: id as Id<"channelMessages">,
    generation: 0,
  })
  expect(graph.to(`/${PHONE_ID}/media`)).toHaveLength(1)
  expect(graph.to(`/${PHONE_ID}/messages`)[0].body).toMatchObject({
    document: { id: "meta-upload" },
  })
  expect(await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))).toMatchObject(
    { state: "ready", storageId, provider: "convex" }
  )
  const url = await f.t.action(internal.storage.objects.url, { fileId: p.id })
  expect(url).toBe(await f.t.run((ctx) => ctx.storage.getUrl(storageId)))
  const link = await f.t.run((ctx) =>
    mediaDownloadLink(ctx, id as Id<"channelMessages">, p.id)
  )
  const download = await f.t.fetch(new URL(link.download_url).pathname)
  expect(download.status).toBe(302)
  expect(download.headers.get("location")).toBe(url)
  // Completion is repeatable for the same receipt.
  await f.owner.client.action(api.storage.objects.completeUpload, {
    organizationId: f.owner.team,
    id: p.id,
    storageId,
  })
})

test.each([
  { size: 4, type: "image/png" },
  { size: 3, type: "text/html" },
])(
  "complete verifies system metadata and cleans up mismatch: %j",
  async (bad) => {
    const f = await setup(),
      p = await pending(f)
    const storageId = await storeUpload(
      f.t,
      new Blob([new Uint8Array(bad.size)], { type: bad.type })
    )
    await expect(
      f.owner.client.action(api.storage.objects.completeUpload, {
        organizationId: f.owner.team,
        id: p.id,
        storageId,
      })
    ).rejects.toBeTruthy()
    await f.t.action(internal.storage.objects.remove, { id: p.id })
    expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
  }
)

test("expired pending uploads and abandoned claimed files are removed", async () => {
  const f = await setup(),
    p = await pending(f)
  const storageId = await storeUpload(
    f.t,
    new Blob(["png"], { type: "image/png" })
  )
  await f.owner.client.mutation(internal.storage.files.beginComplete, {
    organizationId: f.owner.team,
    id: p.id,
    storageId,
  })
  vi.setSystemTime(Date.now() + 16 * 60_000)
  await f.t.mutation(internal.storage.files.expire, {})
  await f.t.action(internal.storage.objects.remove, { id: p.id })
  expect(await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))).toBeNull()
  expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
})

test("inbound Meta media is stored in Convex by an action and retains webhook MIME", async () => {
  const f = await setup()
  let emitted = 0
  fakeGraph([
    {
      path: "/media-stream",
      respond: () => ({ url: "https://cdn.test/file", mime_type: "image/png" }),
    },
    {
      path: "/file",
      respond: () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (emitted++ < 3) controller.enqueue(new Uint8Array(1024))
              else controller.close()
            },
          }),
          { headers: { "Content-Type": "image/png" } }
        ),
    },
  ])
  const webhook = envelope({
    metadata: { phone_number_id: PHONE_ID },
    messages: [
      {
        from: SENDER,
        id: "wamid.stream",
        type: "image",
        image: { id: "media-stream", mime_type: "image/png" },
      },
    ],
  })
  await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, webhook))
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
  const message = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessages")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", "whatsapp").eq("externalId", "wamid.stream")
      )
      .unique()
  )
  await f.t.action(internal.channels.media.fetch, {
    messageId: message!._id,
    mediaId: "media-stream",
  })
  expect(emitted).toBe(4)
  const content = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", message!._id))
      .unique()
  )
  expect(content!.media![0]).toMatchObject({
    fileId: expect.any(String),
    size: 3072,
    contentType: "image/png",
    mimeType: "image/png",
  })
})

test("shared media survives deletion of one message", async () => {
  const f = await setup(),
    p = await pending(f)
  const storageId = await uploaded(
    f,
    p,
    new Blob(["png"], { type: "image/png" })
  )
  const thread = await f.t.run((ctx) => ctx.db.query("conversations").first())
  for (let index = 0; index < 2; index++)
    await f.owner.client.mutation(api.conversations.reply, {
      id: thread!._id,
      fileId: p.id,
    })
  await f.t.mutation(internal.storage.files.discard, { fileId: p.id })
  expect(await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))).toMatchObject(
    { state: "ready", references: 1 }
  )
  await f.t.mutation(internal.storage.files.discard, { fileId: p.id })
  await f.t.action(internal.storage.objects.remove, { id: p.id })
  expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
})

test("completion refuses missing, old, and already-claimed storage receipts", async () => {
  const f = await setup()
  const old = await storeUpload(f.t, new Blob(["png"], { type: "image/png" }))
  vi.setSystemTime(Date.now() + 1000)
  const p = await pending(f)
  await expect(
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: p.id,
    })
  ).rejects.toBeTruthy()
  await expect(
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: p.id,
      storageId: old,
    })
  ).rejects.toBeTruthy()
  const second = await pending(f)
  const storageId = await uploaded(
    f,
    p,
    new Blob(["png"], { type: "image/png" })
  )
  await expect(
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: second.id,
      storageId,
    })
  ).rejects.toBeTruthy()
  expect(
    await f.t.run(async (ctx) => !!(await ctx.storage.get(storageId)))
  ).toBe(true)
})

test("completion checks actual static sticker size even when animation was declared", async () => {
  const f = await setup()
  const p = await f.owner.client.action(api.storage.objects.createUpload, {
    organizationId: f.owner.team,
    input: {
      use: "whatsapp",
      from: f.account,
      filename: "sticker.webp",
      size: 101 * 1024,
      contentType: "image/webp",
      animated: true,
    },
  })
  await expect(
    uploaded(
      f,
      p,
      new Blob([new Uint8Array(101 * 1024)], { type: "image/webp" })
    )
  ).rejects.toBeTruthy()
})
