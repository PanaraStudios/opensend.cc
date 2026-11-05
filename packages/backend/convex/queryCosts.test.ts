import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// Large historical template payloads do not carry a rendered snapshot.
// Search must reserve the later content reads, not just count small headers.
async function templateMessages(
  direction: "inbound" | "outbound",
  type: "template" | "text" = "template"
) {
  const f = await fixture()
  const ids = await f.t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId: f.owner.team,
      businessId: "cost-business",
      businessName: "Cost fixture",
      method: "manual_token",
      encryptedToken: "ciphertext",
      tokenLast4: "test",
      scopes: [],
      status: "active",
    })
    const accountId = await ctx.db.insert("channelAccounts", {
      organizationId: f.owner.team,
      connectionId,
      channel: "messenger",
      externalId: "cost-page",
      displayName: "Cost fixture",
      handle: "Cost fixture",
      status: "active",
      throughputMps: 80,
    })
    const channelContactId = await ctx.db.insert("channelContacts", {
      organizationId: f.owner.team,
      channel: "messenger",
      scopeId: "cost-page",
      externalId: "cost-person",
      profileName: "Customer",
      marketingOptOut: false,
    })
    const messageIds = []
    for (let i = 0; i < 120; i++) {
      const conversationId = await ctx.db.insert("conversations", {
        organizationId: f.owner.team,
        channel: "messenger",
        accountId,
        channelContactId,
        status: "open",
        lastMessageAt: i,
        lastDirection: direction,
        lastPreview: "Needle template",
        unread: false,
        search: "Needle customer",
      })
      const messageId = await ctx.db.insert("channelMessages", {
        organizationId: f.owner.team,
        channel: "messenger",
        accountId,
        channelContactId,
        conversationId,
        direction,
        from: "cost-page",
        to: "cost-person",
        type,
        status: direction === "inbound" ? "received" : "sent",
        preview: "Needle template",
        generation: 0,
        attempts: 0,
      })
      await ctx.db.insert("channelMessageContents", {
        messageId,
        payload: JSON.stringify({
          message: { text: "Needle rendered message" },
          padding: "x".repeat(256 * 1024),
        }),
      })
      messageIds.push(messageId)
    }
    return messageIds
  })
  return { ...f, ids }
}

test.each(["sending", "receiving"] as const)(
  "%s search bounds hydration, honors stricter callers, and preserves every continuation",
  async (kind) => {
    const f = await templateMessages(
      kind === "sending" ? "outbound" : "inbound"
    )
    const query = api.messages[kind]
    const args = {
      organizationId: f.owner.team,
      channel: "messenger" as const,
      search: "Needle",
    }
    const read = (paginationOpts: {
      cursor: string | null
      numItems: number
      endCursor?: string
      maximumRowsRead?: number
      maximumBytesRead?: number
    }) =>
      f.owner.client.run((ctx) =>
        ctx.runQuery(
          query,
          { ...args, paginationOpts },
          {
            transactionLimits: {
              bytesRead: 2 * 1024 * 1024,
              documentsRead: 40,
            },
          }
        )
      )
    const first = await read({ cursor: null, numItems: 40 })
    expect(first.page.length).toBeGreaterThan(0)
    expect(first.page.length).toBeLessThanOrEqual(kind === "sending" ? 2 : 1)
    expect(first.isDone).toBe(false)
    expect(first).toMatchObject({
      pageStatus: "SplitRequired",
      splitCursor: expect.any(String),
    })
    for (const row of first.page) {
      expect(row.kind).toBe("channel")
      if (row.kind === "channel") {
        expect(row.message.preview).toBe("Needle rendered message")
        expect(row.partyLabel).toBe("Customer")
      }
    }
    const replay = await read({
      cursor: null,
      numItems: 1,
      endCursor: first.continueCursor,
      maximumRowsRead: 1,
      maximumBytesRead: 1024,
    })
    expect(replay.page).toHaveLength(1)
    const found = new Set<string>()
    let cursor: string | null = null
    for (let i = 0; i < 125; i++) {
      const page = await read({ cursor, numItems: 40 })
      for (const row of page.page) {
        if (row.kind !== "channel") throw new Error("Expected channel message")
        expect(found.has(row.message._id)).toBe(false)
        found.add(row.message._id)
      }
      if (page.isDone) break
      expect(page.continueCursor).not.toBe(cursor)
      cursor = page.continueCursor
    }
    expect(found).toEqual(new Set(f.ids))
  }
)

test.each(["sending", "receiving"] as const)(
  "%s plain-text search does not reserve unread template bodies",
  async (kind) => {
    const f = await templateMessages(
      kind === "sending" ? "outbound" : "inbound",
      "text"
    )
    const page = await f.owner.client.run((ctx) =>
      ctx.runQuery(
        api.messages[kind],
        {
          organizationId: f.owner.team,
          channel: "messenger",
          search: "Needle",
          paginationOpts: { cursor: null, numItems: 8, maximumRowsRead: 8 },
        },
        {
          transactionLimits: { bytesRead: 2 * 1024 * 1024, documentsRead: 40 },
        }
      )
    )
    expect(page.page).toHaveLength(8)
  }
)

test("Inbox search bounds historical template hydration before reading bodies", async () => {
  const f = await templateMessages("outbound")
  const page = await f.owner.client.run((ctx) =>
    ctx.runQuery(
      api.conversations.list,
      {
        organizationId: f.owner.team,
        search: "Needle",
        paginationOpts: { cursor: null, numItems: 40 },
      },
      {
        transactionLimits: { bytesRead: 2 * 1024 * 1024, documentsRead: 40 },
      }
    )
  )
  expect(page.page).toHaveLength(1)
  expect(page.page[0].conversation.lastPreview).toBe("Needle rendered message")
  expect(page.isDone).toBe(false)
  expect(page.pageStatus).toBe("SplitRequired")
})
