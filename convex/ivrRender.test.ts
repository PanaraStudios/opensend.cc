// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
import { pcmWav } from "../lib/ivr-renderers"
import * as net from "../lib/net/public-fetch"
import type { Id } from "./_generated/dataModel"
beforeEach(() => {
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
    wav = await pcmWav(new Uint8Array([1, 0, 2, 0])).arrayBuffer()
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
  expect(resource.prompt_renders[0].error).toContain("Check the key")
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
    wav = await pcmWav(new Uint8Array([1, 0])).arrayBuffer()
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
