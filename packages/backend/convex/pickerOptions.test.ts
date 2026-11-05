import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import { encryptSecret } from "./secrets"
import { inboundFixture } from "./testHelpers/meta.fixture"

beforeEach(() => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", "picker-fixture-encryption-key-".repeat(3))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

test("searchable pickers reach a saved row past the newest page and hide secrets", async () => {
  const f = await inboundFixture()
  const organizationId = f.owner.team
  const inserted = await f.t.run(async (ctx) => {
    const sealed = await encryptSecret("fixture-secret-value")
    const now = Date.now()
    const credentialId = await ctx.db.insert("voiceProviders", {
      organizationId,
      provider: "gemini",
      label: "seed",
      encryptedKey: sealed,
      lastFour: "alue",
      createdAt: now,
      updatedAt: now,
    })
    const ids = {
      bot: "" as string,
      provider: "" as string,
      ivr: "" as string,
      knowledge: "" as string,
      tool: "" as string,
      foreignBot: "" as string,
    }
    const menu = {
      id: "main",
      name: "Main",
      prompt: { kind: "tts" as const, text: "Hello" },
      options: {},
      noInputAction: { kind: "hangup" as const },
      failureAction: { kind: "hangup" as const },
      timeoutSeconds: 5,
      retries: 2,
      maxDigits: 1,
    }
    for (let i = 0; i < 105; i++) {
      const name = `record${String(i).padStart(3, "0")}`
      const botId = await ctx.db.insert("voiceBots", {
        organizationId,
        engine: "gemini_live",
        name,
        provider: "gemini",
        credentialId,
        model: "fixture-model",
        voice: "fixture-voice",
        language: "en",
        systemPrompt: "Help the caller.",
        greeting: "Hello",
        tools: [],
        handoff: { agents: false },
        maxDurationSeconds: 600,
        silenceTimeoutSeconds: 10,
        recording: false,
        disclosure: "This is AI",
        createdAt: now + i,
        updatedAt: now + i,
      })
      const providerId = await ctx.db.insert("voiceProviders", {
        organizationId,
        provider: i % 2 === 0 ? "gemini" : "sarvam",
        label: name,
        encryptedKey: sealed,
        lastFour: "alue",
        createdAt: now + i,
        updatedAt: now + i,
      })
      const ivrId = await ctx.db.insert("ivrs", {
        organizationId,
        name,
        language: "en",
        entryMenuId: "main",
        menus: [menu],
        webhookSecret: "unused",
        createdAt: now + i,
        updatedAt: now + i,
      })
      const knowledgeId = await ctx.db.insert("knowledgeBases", {
        organizationId,
        name,
        description: "",
        status: "ready",
        createdAt: now + i,
        updatedAt: now + i,
      })
      const toolId = await ctx.db.insert("botTools", {
        organizationId,
        name,
        description: "Read a status",
        parameters: "{}",
        method: "POST",
        url: "https://example.test/tool",
        encryptedHeaders: sealed,
        encryptedSigningSecret: sealed,
        timeoutMs: 5000,
        createdAt: now + i,
        updatedAt: now + i,
      })
      if (i === 0) {
        ids.bot = botId
        ids.provider = providerId
        ids.ivr = ivrId
        ids.knowledge = knowledgeId
        ids.tool = toolId
      }
    }
    ids.foreignBot = await ctx.db.insert("voiceBots", {
      organizationId: f.outsider.team,
      engine: "gemini_live",
      name: "foreignrecord",
      provider: "gemini",
      credentialId,
      model: "fixture-model",
      voice: "fixture-voice",
      language: "en",
      systemPrompt: "Help the caller.",
      greeting: "Hello",
      tools: [],
      handoff: { agents: false },
      maxDurationSeconds: 600,
      silenceTimeoutSeconds: 10,
      recording: false,
      disclosure: "This is AI",
      createdAt: now,
      updatedAt: now,
    })
    return ids
  })
  const args = { organizationId }
  const bots = await f.owner.client.query(api.voice.resources.botOptions, args)
  const providers = await f.owner.client.query(
    api.voice.resources.providerOptions,
    args
  )
  const ivrs = await f.owner.client.query(api.ivr.definitions.options, args)
  const bases = await f.owner.client.query(
    api.knowledge.resources.options,
    args
  )
  const tools = await f.owner.client.query(api.botTools.resources.options, args)
  expect(bots).toHaveLength(20)
  expect(providers).toHaveLength(20)
  expect(ivrs).toHaveLength(20)
  expect(bases).toHaveLength(20)
  expect(tools).toHaveLength(20)
  expect(bots.map((row) => row.name)).not.toContain("record000")
  expect(Object.keys(bots[0]).sort()).toEqual(["id", "name"])
  expect(Object.keys(providers[0]).sort()).toEqual([
    "id",
    "label",
    "lastFour",
    "provider",
  ])
  expect(Object.keys(ivrs[0]).sort()).toEqual(["id", "name"])
  expect(Object.keys(bases[0]).sort()).toEqual(["id", "name"])
  expect(Object.keys(tools[0]).sort()).toEqual(["id", "name"])

  const search = { ...args, search: "record000" }
  expect(
    await f.owner.client.query(api.voice.resources.botOptions, search)
  ).toEqual([{ id: inserted.bot, name: "record000" }])
  expect(
    await f.owner.client.query(api.ivr.definitions.options, search)
  ).toEqual([{ id: inserted.ivr, name: "record000" }])
  expect(
    await f.owner.client.query(api.knowledge.resources.options, search)
  ).toEqual([{ id: inserted.knowledge, name: "record000" }])
  expect(
    await f.owner.client.query(api.botTools.resources.options, search)
  ).toEqual([{ id: inserted.tool, name: "record000" }])
  expect(
    await f.owner.client.query(api.voice.resources.providerOptions, {
      ...search,
      provider: "gemini",
    })
  ).toMatchObject([
    { id: inserted.provider, label: "record000", provider: "gemini" },
  ])
  expect(
    await f.owner.client.query(api.voice.resources.providerOptions, {
      ...search,
      provider: "sarvam",
    })
  ).toEqual([])

  const withSaved = await f.owner.client.query(api.voice.resources.botOptions, {
    ...args,
    selectedIds: [inserted.bot],
  })
  expect(withSaved).toHaveLength(21)
  expect(withSaved.some((row) => row.id === inserted.bot)).toBe(true)
  const foreign = await f.owner.client.query(api.voice.resources.botOptions, {
    ...args,
    selectedIds: [inserted.foreignBot],
  })
  expect(foreign).toHaveLength(20)
  expect(foreign.some((row) => row.id === inserted.foreignBot)).toBe(false)
  const filtered = await f.owner.client.query(
    api.voice.resources.providerOptions,
    { ...args, provider: "gemini" }
  )
  expect(filtered).toHaveLength(20)
  expect(filtered.every((row) => row.provider === "gemini")).toBe(true)
  expect(
    await f.owner.client.query(api.voice.resources.providerOptions, {
      ...args,
      provider: "sarvam",
      selectedIds: [inserted.provider],
    })
  ).toHaveLength(20)

  await expect(
    f.owner.client.query(api.voice.resources.botOptions, {
      ...args,
      selectedIds: Array.from({ length: 65 }, (_, index) => String(index)),
    })
  ).rejects.toThrow("saved items")
  await expect(
    f.outsider.client.query(api.voice.resources.botOptions, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.voice.resources.providerOptions, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.ivr.definitions.options, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.knowledge.resources.options, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.botTools.resources.options, args)
  ).rejects.toThrow("permission")
})
