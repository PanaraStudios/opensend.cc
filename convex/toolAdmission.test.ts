/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, expect, test, vi } from "vitest"
import { internal } from "./_generated/api"
import schema from "./schema"
import { insertTranscript } from "./voice/transcriptCounts"

const modules = import.meta.glob("./**/*.ts")
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function fixture(
  transcripts = 1500,
  media = 300,
  tools = 32,
  maintained = true
) {
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
        await (
          maintained
            ? (row: Parameters<typeof insertTranscript>[1]) =>
                insertTranscript(ctx, row)
            : (row: Parameters<typeof insertTranscript>[1]) =>
                ctx.db.insert("callTranscripts", row)
        )({
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
  const admit = async (
    lane: "builtin" | "toolkit",
    id: string,
    request?: { name: string; arguments: Record<string, unknown> }
  ) => {
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
              ...request,
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
      expect(sample.documentsRead).toBe(3)
      expect(sample.bytesRead).toBeLessThan(4000)
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

for (const lane of ["builtin", "toolkit"] as const) {
  const rejected = { ok: false, error: "Call tool limit reached" }
  const outcome = (
    result: Awaited<
      ReturnType<Awaited<ReturnType<typeof fixture>>["admit"]>
    >["result"]
  ) => (lane === "builtin" ? result : result.result)

  test(`${lane} initializes legacy counters once with a bounded indexed scan`, async () => {
    const f = await fixture(1500, 300, 32, false)
    const first = await f.admit(lane, "legacy:1")
    const second = await f.admit(lane, "legacy:2")
    expect(first.documentsRead).toBe(1836)
    expect(first.bytesRead).toBeGreaterThan(2_000_000)
    expect(second.documentsRead).toBe(3)
    expect(second.bytesRead).toBeLessThan(4000)
    expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject(
      {
        admissionTranscriptCount: 1834,
        admissionToolCount: 34,
      }
    )
    console.info("legacy tool admission benchmark", {
      lane,
      firstDocumentsRead: first.documentsRead,
      firstBytesRead: first.bytesRead,
      firstWallMs: first.wallMs,
      secondDocumentsRead: second.documentsRead,
      secondBytesRead: second.bytesRead,
      secondWallMs: second.wallMs,
    })
  })

  for (const maintained of [false, true]) {
    const label = maintained ? "maintained" : "legacy"
    test.each([1999, 2000, 2001])(
      `${lane} ${label} transcript boundary at %i rows`,
      async (rows) => {
        const f = await fixture(rows - 100, 100, 0, maintained)
        const first = await f.admit(lane, "boundary:1")
        if (rows === 2001) {
          expect(outcome(first.result)).toEqual(rejected)
        } else {
          expect(
            lane === "builtin" ? first.result.ok : first.result.logId
          ).toBeTruthy()
          const next = await f.admit(lane, "boundary:2")
          if (rows === 2000) expect(outcome(next.result)).toEqual(rejected)
          else
            expect(
              lane === "builtin" ? next.result.ok : next.result.logId
            ).toBeTruthy()
        }
        // Replays retain their original result even after the limit is reached.
        expect((await f.admit(lane, "boundary:1")).result).toEqual(
          lane === "builtin" || rows === 2001
            ? first.result
            : {
                result: JSON.parse(
                  (await f.t.run((ctx) =>
                    ctx.db.get("callTranscripts", first.result.logId)
                  ))!.result!
                ),
              }
        )
      }
    )
    test.each([127, 128])(
      `${lane} ${label} tool boundary at %i tools`,
      async (tools) => {
        const f = await fixture(10, 10, tools, maintained)
        const first = await f.admit(lane, "tool-boundary:1")
        if (tools === 128) expect(outcome(first.result)).toEqual(rejected)
        else
          expect(
            lane === "builtin" ? first.result.ok : first.result.logId
          ).toBeTruthy()
        expect(
          outcome((await f.admit(lane, "tool-boundary:2")).result)
        ).toEqual(rejected)
      }
    )
  }
}

test("all transcript writers maintain counts, including notes, deduplication and toolkit finish", async () => {
  const f = await fixture(0, 0, 0)
  const note = await f.admit("builtin", "note", {
    name: "create_note",
    arguments: { text: "Caller asks about an order" },
  })
  expect(note.result.ok).toBe(true)
  expect(
    (
      await f.admit("builtin", "note", {
        name: "create_note",
        arguments: { text: "Caller asks about an order" },
      })
    ).result
  ).toEqual(note.result)
  expect(
    (
      await f.admit("builtin", "note", {
        name: "create_note",
        arguments: { text: "Different note" },
      })
    ).result
  ).toMatchObject({
    ok: false,
    error: "Tool id reused with different arguments",
  })
  for (const type of ["transcript", "state"])
    for (let i = 0; i < 2; i++)
      await f.t.mutation(internal.voice.gateway.event, {
        nonce: crypto.randomUUID(),
        expiresAt: Date.now() + 60000,
        data: {
          callId: f.callId,
          eventId: type,
          type,
          state: "connected",
          timestamp: Date.now(),
          transcript: {
            role: "caller",
            text: "Hello",
            timestampMs: 100,
            final: true,
          },
        },
      })
  const begun = await f.admit("toolkit", "search")
  await f.t.mutation(internal.voice.toolkitState.finish, {
    logId: begun.result.logId,
    result: JSON.stringify({ ok: true, result: [] }),
    latencyMs: 100,
  })
  expect((await f.admit("toolkit", "search")).result).toEqual({
    result: { ok: true, result: [] },
  })
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    admissionTranscriptCount: 6,
    admissionToolCount: 2,
  })
})

test("partial legacy counters are rebuilt and oversized legacy history remains bounded", async () => {
  const f = await fixture(2050, 100, 0, false)
  await f.t.run((ctx) =>
    ctx.db.patch("calls", f.callId, { admissionTranscriptCount: 0 })
  )
  expect((await f.admit("builtin", "oversized")).result).toEqual({
    ok: false,
    error: "Call tool limit reached",
  })
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    admissionTranscriptCount: 2001,
    admissionToolCount: 0,
  })
  expect((await f.admit("toolkit", "oversized")).documentsRead).toBe(1)
})

test("a note tool admitted at 2,000 rows still writes both rows and saturates the count", async () => {
  const f = await fixture(1900, 100, 0)
  expect(
    (
      await f.admit("builtin", "last-note", {
        name: "create_note",
        arguments: { text: "Last note" },
      })
    ).result.ok
  ).toBe(true)
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    admissionTranscriptCount: 2001,
    admissionToolCount: 1,
  })
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("callTranscripts")
        .withIndex("by_callId", (q) => q.eq("callId", f.callId))
        .take(2003)
    )
  ).toHaveLength(2002)
  expect((await f.admit("builtin", "too-late")).result.error).toBe(
    "Call tool limit reached"
  )
})

test("validation rejections do not consume capacity, but admitted execution failures do", async () => {
  const f = await fixture(10, 10, 127)
  expect(
    (
      await f.admit("builtin", "invalid", {
        name: "end_call",
        arguments: { unexpected: true },
      })
    ).result
  ).toMatchObject({ ok: false, error: "Invalid tool arguments" })
  const failed = await f.admit("builtin", "failed-note", {
    name: "create_note",
    arguments: { text: " " },
  })
  expect(failed.result.ok).toBe(false)
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    admissionTranscriptCount: 148,
    admissionToolCount: 128,
  })
  expect(
    (
      await f.admit("builtin", "failed-note", {
        name: "create_note",
        arguments: { text: " " },
      })
    ).result
  ).toEqual(failed.result)
  expect((await f.admit("toolkit", "too-late")).result.result.error).toBe(
    "Call tool limit reached"
  )
})

test("legacy initialization and tool insertion roll back together", async () => {
  const f = await fixture(10, 10, 127, false)
  await expect(
    f.t.run(async (ctx) => {
      await ctx.runMutation(internal.voice.toolkitState.begin, {
        nonce: crypto.randomUUID(),
        expiresAt: Date.now() + 60000,
        data: {
          callId: f.callId,
          toolCall: {
            id: "rollback",
            name: "search_knowledge",
            arguments: { query: "Hours" },
          },
        },
      })
      throw new Error("Roll back admission")
    })
  ).rejects.toThrow("Roll back admission")
  const call = await f.t.run((ctx) => ctx.db.get("calls", f.callId))
  expect(call!.admissionTranscriptCount).toBeUndefined()
  expect(call!.admissionToolCount).toBeUndefined()
  expect((await f.admit("toolkit", "rollback")).result.logId).toBeTruthy()
})
