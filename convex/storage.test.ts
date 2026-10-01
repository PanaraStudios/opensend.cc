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

const bucket = vi.hoisted(
  () => new Map<string, { type: string; size: number; bytes?: Uint8Array }>()
)
const uploads = vi.hoisted(
  () => [] as { queueSize: number; partSize: number; chunks: number }[]
)
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (
    _client: unknown,
    command: { input: { Key: string } },
    options: { expiresIn: number }
  ) => `https://bucket.test/${command.input.Key}?ttl=${options.expiresIn}`,
}))
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aws-sdk/client-s3")>()
  return {
    ...original,
    S3Client: class {
      async send(command: {
        constructor: { name: string }
        input: { Key: string; CopySource?: string }
      }) {
        const key = command.input.Key
        if (command.constructor.name === "HeadObjectCommand") {
          const file = bucket.get(key)
          if (!file) throw new Error("NoSuchKey")
          return { ContentLength: file.size, ContentType: file.type }
        }
        if (command.constructor.name === "CopyObjectCommand") {
          bucket.set(key, {
            ...bucket.get(
              decodeURIComponent(
                command.input.CopySource!.split("/").slice(1).join("/")
              )
            )!,
          })
          return {}
        }
        if (command.constructor.name === "DeleteObjectCommand") {
          bucket.delete(key)
          return {}
        }
        if (command.constructor.name === "GetObjectCommand")
          return {
            Body: {
              transformToByteArray: async () =>
                bucket.get(key)?.bytes ?? new Uint8Array(32),
            },
          }
        throw new Error(`Unexpected command ${command.constructor.name}`)
      }
    },
  }
})
vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    constructor(
      private options: {
        params: {
          Key: string
          ContentType: string
          Body: AsyncIterable<Uint8Array>
        }
        queueSize: number
        partSize: number
      }
    ) {}
    async done() {
      let size = 0,
        chunks = 0
      for await (const chunk of this.options.params.Body) {
        size += chunk.byteLength
        chunks++
      }
      uploads.push({
        queueSize: this.options.queueSize,
        partSize: this.options.partSize,
        chunks,
      })
      bucket.set(this.options.params.Key, {
        type: this.options.params.ContentType,
        size,
      })
    }
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "storage-test-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "storage-test-download-secret")
  vi.stubEnv("OBJECT_STORAGE_BUCKET", "test")
  vi.stubEnv("OBJECT_STORAGE_ENDPOINT", "https://bucket.test")
  vi.stubEnv("OBJECT_STORAGE_ACCESS_KEY_ID", "storage-key")
  vi.stubEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY", "storage-secret")
  bucket.clear()
  uploads.length = 0
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
test("presign, verify, and send use a fresh bucket link with team isolation", async () => {
  const f = await setup()
  const p = await pending(f, 21 * 1024 * 1024, "application/pdf")
  const row = await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))
  bucket.set(row!.pendingKey!, { size: row!.size, type: row!.contentType })
  await f.owner.client.action(api.storage.objects.completeUpload, {
    organizationId: f.owner.team,
    id: p.id,
  })
  // The original signed PUT is still writable, but no longer names the accepted object.
  bucket.set(row!.pendingKey!, { size: 1, type: "text/html" })
  expect(bucket.get(row!.key!)).toMatchObject({
    size: row!.size,
    type: "application/pdf",
  })
  await expect(
    f.outsider.client.action(api.storage.objects.completeUpload, {
      organizationId: f.outsider.team,
      id: p.id,
    })
  ).rejects.toBeTruthy()
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.object" }] }),
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
  expect(graph.calls[0].body).toMatchObject({
    document: { link: `https://bucket.test/${row!.key}?ttl=3600` },
  })
  expect(graph.to(`/${PHONE_ID}/media`)).toHaveLength(0)
})
test.each([
  { size: 4, type: "image/png" },
  { size: 3, type: "text/html" },
])("complete rejects mismatch and schedules cleanup: %j", async (bad) => {
  const f = await setup(),
    p = await pending(f)
  const row = await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))
  bucket.set(row!.pendingKey!, bad)
  await expect(
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: p.id,
    })
  ).rejects.toBeTruthy()
  await f.t.action(internal.storage.objects.remove, { id: p.id })
  expect(bucket.has(row!.pendingKey!)).toBe(false)
})
test("expired pending uploads delete their bucket objects", async () => {
  const f = await setup(),
    p = await pending(f)
  const row = await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))
  bucket.set(row!.pendingKey!, { size: 3, type: "image/png" })
  vi.setSystemTime(Date.now() + 16 * 60_000)
  await f.t.mutation(internal.storage.files.expire, {})
  await f.t.action(internal.storage.objects.remove, { id: p.id })
  expect(await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))).toBeNull()
  expect(bucket.size).toBe(0)
})
test("bucketless direct uploads preserve local files and the 20 MB cap", async () => {
  vi.stubEnv("OBJECT_STORAGE_BUCKET", "")
  const f = await setup()
  await expect(
    pending(f, 21 * 1024 * 1024, "application/pdf")
  ).rejects.toMatchObject({
    data: expect.objectContaining({
      message: expect.stringContaining("20 MB"),
    }),
  })
  const p = await pending(f)
  expect(p.provider).toBe("convex")
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["png"], { type: "image/png" }))
  )
  await f.t.mutation(internal.storage.files.localStored, {
    id: p.id,
    storageId,
  })
  await f.owner.client.action(api.storage.objects.completeUpload, {
    organizationId: f.owner.team,
    id: p.id,
    storageId,
  })
  expect(await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))).toMatchObject(
    { state: "ready", provider: "convex", storageId }
  )
})
test("inbound Meta media streams multipart parts and retains webhook MIME", async () => {
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
  expect(uploads[0]).toMatchObject({ queueSize: 2, partSize: 5 * 1024 * 1024 })
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

test("migration resumes from checkpoints and rewrites each legacy reference once", async () => {
  const f = await setup()
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["csv"], { type: "text/csv;charset=utf-8" }))
  )
  const exportId = await f.t.run((ctx) =>
    ctx.db.insert("exports", {
      organizationId: f.owner.team,
      resource: "contacts",
      status: "ready",
      rows: 1,
      storageId,
      expiresAt: Date.now() + 86400_000,
      filters: {},
    })
  )
  const jobId = await f.t.mutation(internal.storage.migration.start, {})
  // A repeated start queues no second owner while a worker holds its lease.
  for (let step = 0; step < 9; step++)
    await f.t.action(internal.storage.migrate.run, { id: jobId })
  expect(await f.t.query(internal.storage.migration.status, {})).toMatchObject({
    status: "complete",
    copied: 1,
  })
  const row = await f.t.run((ctx) => ctx.db.get("exports", exportId))
  expect(row?.storageId).toBeUndefined()
  const file = await f.t.run((ctx) => ctx.db.get("storedFiles", row!.fileId!))
  expect(file).toMatchObject({
    provider: "object",
    sourceStorageId: storageId,
    references: 1,
  })
  expect(bucket.get(file!.key!)?.size).toBe(3)
  await f.t.mutation(internal.storage.migration.start, {})
  expect(await f.t.query(internal.storage.migration.status, {})).toMatchObject({
    copied: 1,
  })
})

test("shared media survives deletion of one message and late PUTs have a cleanup job", async () => {
  const f = await setup(),
    p = await pending(f)
  const row = await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))
  bucket.set(row!.pendingKey!, { size: 3, type: "image/png" })
  await f.owner.client.action(api.storage.objects.completeUpload, {
    organizationId: f.owner.team,
    id: p.id,
  })
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
  expect(bucket.has(row!.key!)).toBe(false)
  // A still-live PUT can recreate the temporary key; cleanup is scheduled past its TTL.
  const scheduled = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  )
  expect(scheduled.some((job) => job.name.includes("removePending"))).toBe(true)
})

test("local completion refuses arbitrary storage ids and signed uploads bind their owner", async () => {
  vi.stubEnv("OBJECT_STORAGE_BUCKET", "")
  const f = await setup(),
    p = await pending(f)
  const unrelated = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["png"], { type: "image/png" }))
  )
  await expect(
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: p.id,
      storageId: unrelated,
    })
  ).rejects.toBeTruthy()
  const response = await f.t.fetch(new URL(p.upload_url).pathname, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: "png",
  })
  expect(response.status).toBe(200)
  const { storageId } = await response.json()
  await f.owner.client.action(api.storage.objects.completeUpload, {
    organizationId: f.owner.team,
    id: p.id,
    storageId,
  })
  expect(await f.t.run((ctx) => ctx.db.get("storedFiles", p.id))).toMatchObject(
    { state: "ready" }
  )
})
