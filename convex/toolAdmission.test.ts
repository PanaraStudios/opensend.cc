/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, expect, test, vi } from "vitest"
import { internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function fixture(transcripts = 1500, media = 300, tools = 32) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const t = convexTest({ schema, modules, transactionLimits: true })
  const callId = await t.run(async (ctx) => {
    const organizationId = "tool-admission-benchmark"
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId,
      businessId: "benchmark",
      businessName: "Benchmark",
      method: "manual_token",
      encryptedToken: "unused",
      tokenLast4: "none",
      scopes: [],
      status: "active",
    })
    const accountId = await ctx.db.insert("channelAccounts", {
      organizationId,
      connectionId,
      channel: "whatsapp",
      externalId: "benchmark",
      displayName: "Benchmark",
      handle: "benchmark",
      status: "active",
      throughputMps: 80,
    })
    const credentialId = await ctx.db.insert("voiceProviders", {
      organizationId,
      provider: "gemini",
      label: "Unused in admission",
      encryptedKey: "unused",
      lastFour: "none",
      createdAt: 0,
      updatedAt: 0,
    })
    const baseId = await ctx.db.insert("knowledgeBases", {
      organizationId,
      name: "Benchmark",
      description: "Benchmark",
      status: "ready",
      createdAt: 0,
      updatedAt: 0,
    })
    const config = {
      engine: "gemini_live" as const,
      name: "Benchmark",
      provider: "gemini" as const,
      credentialId,
      model: "benchmark",
      voice: "benchmark",
      language: "en",
      systemPrompt: "Help the caller",
      greeting: "Hello",
      tools: ["end_call", "create_note"],
      knowledgeBaseIds: [baseId],
      handoff: { agents: false },
      maxDurationSeconds: 3600,
      silenceTimeoutSeconds: 30,
      recording: false,
      disclosure: "",
    }
    const botId = await ctx.db.insert("voiceBots", {
      organizationId,
      ...config,
      createdAt: 0,
      updatedAt: 0,
    })
    return ctx.db.insert("calls", {
      organizationId,
      accountId,
      botId,
      botConfig: config,
      botActive: true,
      direction: "inbound",
      status: "connected",
      mode: "gateway",
      observedAt: 0,
    })
  })
  // Keep seeding separate from the measured admission transaction.
  await t.run(async (ctx) => {
    for (const [kind, count] of [
      ["transcript", transcripts],
      ["media", media],
      ["tool", tools],
    ] as const)
      for (let i = 0; i < count; i++)
        await ctx.db.insert("callTranscripts", {
          organizationId: "tool-admission-benchmark",
          callId,
          eventId: `${kind}:${i}`,
          kind,
          timestampMs: i * 1000,
          timeline: "call",
          ...(kind === "transcript"
            ? {
                role: i % 2 ? ("agent" as const) : ("caller" as const),
                text: "Caller discusses their order. "
                  .repeat(70)
                  .slice(0, 500 + (i % 1501)),
                final: true,
              }
            : kind === "tool"
              ? {
                  toolId: `seed:${i}`,
                  toolName: "end_call",
                  arguments: "{}",
                  result: JSON.stringify({ ok: true }),
                }
              : { text: JSON.stringify({ type: "usage", audioSeconds: i }) }),
        })
  })
  const admit = async (lane: "builtin" | "toolkit", id: string) => {
    const started = performance.now()
    const measured = await t.run(async (ctx) => {
      const result = await ctx.runMutation(
        lane === "builtin"
          ? internal.voice.gateway.tool
          : internal.voice.toolkitState.begin,
        {
          nonce: crypto.randomUUID(),
          expiresAt: Date.now() + 60000,
          data: {
            callId,
            toolCall: {
              id,
              name: lane === "builtin" ? "end_call" : "search_knowledge",
              arguments: lane === "builtin" ? {} : { query: "Order status" },
            },
          },
        }
      )
      const metrics = await ctx.meta.getTransactionMetrics()
      return {
        result,
        documentsRead: metrics.documentsRead.used,
        bytesRead: metrics.bytesRead.used,
      }
    })
    return { ...measured, wallMs: performance.now() - started }
  }
  return { t, callId, admit }
}

test.each(["builtin", "toolkit"] as const)(
  "%s long-call admission benchmark",
  async (lane) => {
    const f = await fixture()
    const samples = []
    for (let i = 0; i < 5; i++) {
      const sample = await f.admit(lane, `benchmark:${i}`)
      expect(
        lane === "builtin" ? sample.result.ok : sample.result.logId
      ).toBeTruthy()
      expect(sample.documentsRead).toBeGreaterThanOrEqual(1833)
      expect(sample.bytesRead).toBeGreaterThan(2_000_000)
      samples.push(sample)
    }
    console.info("tool admission benchmark", {
      lane,
      firstDocumentsRead: samples[0].documentsRead,
      firstBytesRead: samples[0].bytesRead,
      firstWallMs: samples[0].wallMs,
      medianWallMs: samples.map((s) => s.wallMs).sort((a, b) => a - b)[2],
    })
  }
)
