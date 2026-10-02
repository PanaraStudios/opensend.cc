// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
import { pcmWav } from "../lib/ivr-renderers"
import * as audio from "./storage/ivrAudio"
import * as net from "../lib/net/public-fetch"
import type { Id } from "./_generated/dataModel"
beforeEach(() => {
  vi.spyOn(audio, "normalizeIvrAudio").mockImplementation(async () =>
    pcmWav(new Uint8Array([1, 0, 2, 0]), 16000)
  )
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
async function setup() {
  const f = await inboundFixture()
  const credential = await f.owner.client.action(
    api.voice.resources.dashboardWrite,
    {
      organizationId: f.owner.team,
      kind: "provider",
      body: JSON.stringify({
        provider: "sarvam",
        label: "Prompts",
        key: "private-key-1234",
      }),
    }
  )
  const input = {
    name: "Reception",
    language: "en",
    entryMenuId: "main",
    promptVoice: {
      provider: "sarvam",
      voice: "shubh",
      language: "en-IN",
      credentialId: credential.id,
    },
    menus: [
      {
        id: "main",
        name: "Main",
        prompt: { kind: "tts", text: "Hello" },
        options: {},
        noInputAction: { kind: "hangup" },
        failureAction: { kind: "hangup" },
      },
    ],
  }
  const saved = await f.owner.client.action(
    api.ivr.definitions.dashboardWrite,
    {
      organizationId: f.owner.team,
      kind: "create",
      body: JSON.stringify(input),
    }
  )
  const id = saved.id as Id<"ivrs">
  return { ...f, id, input, credentialId: credential.id }
}
test("rendering uses the team key, caches by content hash and exposes ready audio", async () => {
  const f = await setup(),
    wav = await pcmWav(new Uint8Array([1, 0, 2, 0]), 24000).arrayBuffer()
  const http = vi
    .spyOn(net, "publicFetch")
    .mockImplementation(async (_url, init) => {
      expect(init!.headers!["api-subscription-key"]).toBe("private-key-1234")
      return Response.json({ audios: [Buffer.from(wav).toString("base64")] })
    })
  await f.t.action(internal.ivr.rendering.render, { id: f.id })
  const resource = await f.owner.client.query(
    api.ivr.definitions.dashboardGet,
    { organizationId: f.owner.team, id: f.id }
  )
  expect(resource.prompt_status).toBe("ready")
  expect(resource.prompt_renders[0].status).toBe("ready")
  expect(resource.prompt_renders[0].audio_url).toBeTruthy()
  await f.owner.client.action(api.ivr.definitions.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "update",
    id: f.id,
    body: JSON.stringify(f.input),
  })
  await f.t.action(internal.ivr.rendering.render, { id: f.id })
  expect(http).toHaveBeenCalledTimes(1)
  await expect(
    f.owner.client.action(api.voice.resources.dashboardWrite, {
      organizationId: f.owner.team,
      kind: "removeProvider",
      id: f.credentialId,
      body: "{}",
    })
  ).rejects.toBeDefined()
})
test("render failure is per-prompt, secrets stay hidden and failed prompts can retry", async () => {
  const f = await setup(),
    http = vi
      .spyOn(net, "publicFetch")
      .mockResolvedValue(new Response("private-key-1234", { status: 401 }))
  await f.t.action(internal.ivr.rendering.render, { id: f.id })
  const resource = await f.owner.client.query(
    api.ivr.definitions.dashboardGet,
    { organizationId: f.owner.team, id: f.id }
  )
  expect(resource.prompt_status).toBe("failed")
  expect(resource.prompt_renders[0].error).toBe("Sarvam: [redacted]")
  expect(JSON.stringify(resource)).not.toContain("private-key-1234")
  expect(http).toHaveBeenCalledTimes(1)
  const retry = await f.owner.client.action(api.ivr.rendering.dashboardRender, {
    organizationId: f.owner.team,
    id: f.id,
  })
  expect(retry.prompt_renders[0].status).toBe("pending_render")
  await expect(
    f.outsider.client.action(api.ivr.rendering.dashboardRender, {
      organizationId: f.outsider.team,
      id: f.id,
    })
  ).rejects.toBeDefined()
})
test("an IVR cannot select another team's provider credential", async () => {
  const f = await setup()
  await expect(
    f.outsider.client.action(api.ivr.definitions.dashboardWrite, {
      organizationId: f.outsider.team,
      kind: "create",
      body: JSON.stringify(f.input),
    })
  ).rejects.toBeDefined()
})

test("identical hashes are cached independently for different teams", async () => {
  const f = await setup(),
    wav = await pcmWav(new Uint8Array([1, 0]), 24000).arrayBuffer()
  vi.spyOn(net, "publicFetch").mockResolvedValue(
    Response.json({ audios: [Buffer.from(wav).toString("base64")] })
  )
  await f.t.action(internal.ivr.rendering.render, { id: f.id })
  const key = await f.outsider.client.action(
    api.voice.resources.dashboardWrite,
    {
      organizationId: f.outsider.team,
      kind: "provider",
      body: JSON.stringify({
        provider: "sarvam",
        label: "Other team",
        key: "other-private-key-9876",
      }),
    }
  )
  const foreign = await f.outsider.client.action(
    api.ivr.definitions.dashboardWrite,
    {
      organizationId: f.outsider.team,
      kind: "create",
      body: JSON.stringify({
        ...f.input,
        promptVoice: { ...f.input.promptVoice, credentialId: key.id },
      }),
    }
  )
  const own = await f.owner.client.query(api.ivr.definitions.dashboardGet, {
    organizationId: f.owner.team,
    id: f.id,
  })
  const other = await f.outsider.client.query(
    api.ivr.definitions.dashboardGet,
    { organizationId: f.outsider.team, id: foreign.id as string }
  )
  expect(own.prompt_renders[0].hash).toBe(other.prompt_renders[0].hash)
  expect(own.prompt_renders[0].status).toBe("ready")
  expect(other.prompt_renders[0].status).toBe("pending_render")
  expect(other.prompt_renders[0].audio_url).toBeNull()
  await expect(
    f.owner.client.query(api.ivr.definitions.dashboardGet, {
      organizationId: f.owner.team,
      id: foreign.id as string,
    })
  ).rejects.toBeDefined()
})

test("PATCH null clears a saved provider voice and business hours", async () => {
  const f = await setup()
  await f.owner.client.action(api.ivr.definitions.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "update",
    id: f.id,
    body: JSON.stringify({
      businessHours: { status: "DISABLED", closedAction: { kind: "hangup" } },
    }),
  })
  await f.owner.client.action(api.ivr.definitions.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "update",
    id: f.id,
    body: JSON.stringify({ promptVoice: null, businessHours: null }),
  })
  const row = await f.owner.client.query(api.ivr.definitions.dashboardGet, {
    organizationId: f.owner.team,
    id: f.id,
  })
  expect(row.promptVoice).toBeUndefined()
  expect(row.businessHours).toBeUndefined()
  await expect(
    f.owner.client.action(api.ivr.rendering.dashboardRender, {
      organizationId: f.owner.team,
      id: f.id,
    })
  ).rejects.toBeDefined()
})

test("saving a corrected provider key retries failed content while retaining its hash", async () => {
  const f = await setup(),
    wav = await pcmWav(new Uint8Array([1, 0]), 24000).arrayBuffer()
  const http = vi
    .spyOn(net, "publicFetch")
    .mockResolvedValue(new Response("invalid key", { status: 401 }))
  await f.t.action(internal.ivr.rendering.render, { id: f.id })
  const before = await f.owner.client.query(api.ivr.definitions.dashboardGet, {
    organizationId: f.owner.team,
    id: f.id,
  })
  const key = await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "provider",
    body: JSON.stringify({
      provider: "sarvam",
      label: "Corrected",
      key: "corrected-provider-key",
    }),
  })
  await f.owner.client.action(api.ivr.definitions.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "update",
    id: f.id,
    body: JSON.stringify({
      promptVoice: { ...f.input.promptVoice, credentialId: key.id },
    }),
  })
  const pending = await f.owner.client.query(api.ivr.definitions.dashboardGet, {
    organizationId: f.owner.team,
    id: f.id,
  })
  expect(pending.prompt_status).toBe("pending_render")
  expect(pending.prompt_renders[0].hash).toBe(before.prompt_renders[0].hash)
  http.mockImplementation(async (_url, options) => {
    expect(options!.headers!["api-subscription-key"]).toBe(
      "corrected-provider-key"
    )
    return Response.json({ audios: [Buffer.from(wav).toString("base64")] })
  })
  await f.t.action(internal.ivr.rendering.render, { id: f.id })
  expect(
    (
      await f.owner.client.query(api.ivr.definitions.dashboardGet, {
        organizationId: f.owner.team,
        id: f.id,
      })
    ).prompt_status
  ).toBe("ready")
})

test("uploaded IVR audio is normalized once before readiness and completion remains idempotent", async () => {
  const f = await inboundFixture()
  const { storeUpload } = await import("./testHelpers/storage.fixture")
  const original = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" })
  const upload = await f.owner.client.action(api.storage.objects.createUpload, {
    organizationId: f.owner.team,
    input: {
      use: "ivr",
      filename: "welcome.mp3",
      contentType: original.type,
      size: original.size,
    },
  })
  const storageId = await storeUpload(f.t, original)
  const finish = () =>
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: upload.id,
      storageId,
    })
  await finish()
  await finish()
  expect(audio.normalizeIvrAudio).toHaveBeenCalledTimes(1)
  const row = await f.t.run((ctx) => ctx.db.get("storedFiles", upload.id))
  expect(row).toMatchObject({
    state: "ready",
    contentType: "audio/wav",
    filename: "welcome.wav",
    uploadStorageId: storageId,
  })
  expect(row?.storageId).not.toBe(storageId)
  const bytes = await f.t.run(async (ctx) =>
    (await ctx.storage.get(row!.storageId!))!.arrayBuffer()
  )
  expect(new DataView(bytes).getUint32(24, true)).toBe(16000)
  expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
})

test("invalid IVR upload never becomes playable when normalization fails", async () => {
  const f = await inboundFixture()
  const { storeUpload } = await import("./testHelpers/storage.fixture")
  vi.mocked(audio.normalizeIvrAudio).mockRejectedValueOnce(
    new Error("Invalid audio")
  )
  const upload = await f.owner.client.action(api.storage.objects.createUpload, {
    organizationId: f.owner.team,
    input: {
      use: "ivr",
      filename: "broken.wav",
      contentType: "audio/wav",
      size: 3,
    },
  })
  const storageId = await storeUpload(
    f.t,
    new Blob(["bad"], { type: "audio/wav" })
  )
  await expect(
    f.owner.client.action(api.storage.objects.completeUpload, {
      organizationId: f.owner.team,
      id: upload.id,
      storageId,
    })
  ).rejects.toThrow("Invalid audio")
  const row = await f.t.run((ctx) => ctx.db.get("storedFiles", upload.id))
  expect(row?.state).not.toBe("ready")
})
