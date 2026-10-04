import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type ConsoleMessage, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import { backendRows, client, importFixture } from "./ses-fixtures"
import { beginOAuth, selectOAuthTeam } from "./oauth-flow"

type Screen = { name: string; open: (page: Page) => Promise<void> }
type Finding = {
  screen: string
  theme: string
  width: number
  kind: string
  detail: unknown
  screenshot: string
}
const channels = ["All channels", "Email", "WhatsApp", "Messenger", "Instagram"]
type TourState = () => {
  owner: Page
  organizationId: string
  sendingDomainId: Id<"domains">
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

/** Runs last: the disposable instance already has messages, identities and runs.
 * Fixture imports are guarded by assertTestOwnership in ses-fixtures.ts. */
export function screensTourTests(state: TourState) {
  test.fixme("F05: mobile automation builder, trigger picker and observability await the flow-editor branch", () => {})
  test("screens tour: every v2 screen in light/dark at 1280/390", async () => {
    test.setTimeout(20 * 60_000)
    const { owner, organizationId, sendingDomainId } = state()
    // Copy the real owner's session into a fresh context, without trace scripts
    // left by earlier tests, and isolate the tour's theme/viewport changes.
    const context = await owner
      .context()
      .browser()!
      .newContext({
        storageState: await owner.context().storageState(),
        baseURL: process.env.OPENSEND_BASE_URL,
      })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    const dir = join(process.env.OPENSEND_TEST_RESULTS!, "tour")
    mkdirSync(dir, { recursive: true })
    const findings: Finding[] = []
    const visited: string[] = []
    const backend = await client(owner)
    const accounts = backendRows<Doc<"channelAccounts">>(
      "channelAccounts"
    ).filter(
      (r) => r.organizationId === organizationId && r.status !== "disconnected"
    )
    const whatsapp = accounts.find((r) => r.channel === "whatsapp")!
    expect(whatsapp, "Seeded WhatsApp channel").toBeTruthy()
    const contacts = backendRows<Doc<"contacts">>("contacts", 1000).filter(
      (r) => r.organizationId === organizationId
    )
    const contact =
      contacts.find((r) => r.phone && r.firstName === "Ada") ??
      contacts.find((r) => r.phone)!
    expect(contact, "Seeded contact").toBeTruthy()
    await backend.mutation(api.contactNotes.create, {
      contactId: contact._id,
      body: "QA tour: caller asked about support hours. Follow up tomorrow.",
    })
    const bots = backendRows<Doc<"voiceBots">>("voiceBots").filter(
      (r) => r.organizationId === organizationId
    )
    let botId: string = bots[0]?._id ?? ""
    if (!botId) {
      const provider = (await backend.action(
        api.voice.resources.dashboardWrite,
        {
          organizationId,
          kind: "provider",
          body: JSON.stringify({
            provider: "gemini",
            label: "QA Gemini",
            key: "qa-fixture-not-a-live-provider-key",
          }),
        }
      )) as { id: string }
      const created = (await backend.action(
        api.voice.resources.dashboardWrite,
        {
          organizationId,
          kind: "bot",
          body: JSON.stringify({
            name: "QA support",
            engine: "gemini_live",
            provider: "gemini",
            credentialId: provider.id,
            tools: ["lookup_contact", "create_note", "end_call"],
          }),
        }
      )) as { id: string }
      botId = created.id
    }
    const knowledge = (await backend.action(
      api.knowledge.resources.dashboardWrite,
      {
        organizationId,
        body: JSON.stringify({
          name: "Support handbook",
          description: "Reference material for the support team.",
        }),
      }
    )) as { id: string }
    // No live AI credentials: seed an already indexed document for visual QA.
    importFixture("knowledgeDocuments", {
      organizationId,
      knowledgeBaseId: knowledge.id,
      title: "Support hours",
      source: "text",
      byteSize: 52,
      status: "ready",
      revision: "qa-tour",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const tool = await backend.action(api.botTools.resources.dashboardWrite, {
      organizationId,
      body: JSON.stringify({
        name: "check_order",
        description: "Check the delivery status of a customer's order.",
        parameters: {
          type: "object",
          properties: {
            order_number: { type: "string", description: "Order number" },
          },
          required: ["order_number"],
        },
        method: "POST",
        url: "https://example.test/orders/status",
      }),
    })
    // Attach representative toolkit configuration without making provider requests.
    await backend.action(api.voice.resources.dashboardWrite, {
      organizationId,
      kind: "bot",
      id: botId,
      body: JSON.stringify({
        knowledgeBaseIds: [knowledge.id],
        customToolIds: [(tool as { id: string }).id],
        collect: [
          {
            key: "order_number",
            label: "Order number",
            description: "The customer's order reference",
            type: "text",
            required: true,
          },
        ],
      }),
    })
    const bases = backendRows<Doc<"knowledgeBases">>("knowledgeBases")
    importFixture(
      "knowledgeBases",
      bases.map((r) =>
        r._id === knowledge.id ? { ...r, documentCount: 1 } : r
      ),
      true
    )
    const knowledgeDocument = backendRows<Doc<"knowledgeDocuments">>(
      "knowledgeDocuments"
    ).find((r) => r.knowledgeBaseId === knowledge.id)!
    importFixture("knowledgeDocumentTexts", {
      organizationId,
      documentId: knowledgeDocument._id,
      text: "Support is available Monday to Friday, 9am to 5pm.",
    })

    importFixture("calls", {
      organizationId,
      accountId: whatsapp._id,
      contactId: contact._id,
      direction: "inbound",
      status: "completed",
      mode: "gateway",
      from: contact.phone,
      to: whatsapp.handle,
      observedAt: Date.now() - 60_000,
      duration: 45,
      botId: botId,
      botOutcome: "completed",
      botSummary:
        "The caller asked about support hours and received an answer.",
      collected: { order_number: { value: "ORD-123", inferred: false } },
    })
    const call = backendRows<Doc<"calls">>("calls").find(
      (r) => r.botId === botId && r.botSummary?.startsWith("The caller asked")
    )!
    expect(call).toBeTruthy()
    importFixture("callTranscripts", [
      {
        organizationId,
        callId: call._id,
        eventId: "qa-answer",
        kind: "transcript",
        role: "agent",
        text: "Our support team is available Monday to Friday, 9am to 5pm.",
        final: true,
        timestampMs: 2200,
        timeline: "call",
      },
      {
        organizationId,
        callId: call._id,
        eventId: "qa-question",
        kind: "transcript",
        role: "caller",
        text: "When is your support team available?",
        final: true,
        timestampMs: 1000,
        timeline: "call",
      },
    ])
    const sendingDomain = await backend.query(api.domains.get, {
      id: sendingDomainId,
    })
    expect(sendingDomain, "Seeded sending domain").not.toBeNull()
    const draftId = await backend.mutation(api.broadcasts.create, {
      organizationId,
      name: "Support newsletter",
      subject: "Your support update",
      from: `Support <hello@${sendingDomain!.domain.name}>`,
      html: "<p>Here is this month's support update.</p>",
    })
    const automations = backendRows<Doc<"automations">>("automations").filter(
      (r) => r.organizationId === organizationId
    )
    const automation = automations.find(
      (r) => r.trigger === "opensend:whatsapp.message.received"
    )!
    expect(automation, "Seeded automation and observability run").toBeTruthy()
    const ivrs = backendRows<Doc<"ivrs">>("ivrs").filter(
      (r) => r.organizationId === organizationId
    )
    let ivrId: string = ivrs[0]?._id ?? ""
    if (!ivrId) {
      const created = await backend.action(api.ivr.definitions.dashboardWrite, {
        organizationId,
        kind: "create",
        body: JSON.stringify({
          name: "QA reception",
          language: "en",
          entryMenuId: "main",
          menus: [
            {
              id: "main",
              name: "Main",
              prompt: { kind: "tts", text: "Press one for support" },
              options: { "1": { kind: "voicemail" } },
              noInputAction: { kind: "hangup" },
              failureAction: { kind: "hangup" },
            },
          ],
        }),
      })
      ivrId = String(created.id)
    }
    const messages = backendRows<Doc<"channelMessages">>(
      "channelMessages",
      1000
    ).filter((r) => r.organizationId === organizationId)
    const emails = backendRows<Doc<"emails">>("emails", 1000).filter(
      (r) => r.organizationId === organizationId
    )
    const received = backendRows<Doc<"receivedEmails">>(
      "receivedEmails",
      1000
    ).filter((r) => r.organizationId === organizationId)
    const broadcasts = backendRows<Doc<"broadcasts">>("broadcasts").filter(
      (r) => r.organizationId === organizationId
    )
    const keys = backendRows<Doc<"apiKeys">>("apiKeys").filter(
      (r) => r.organizationId === organizationId
    )
    const logs = backendRows<Doc<"apiLogs">>("apiLogs").filter(
      (r) => r.organizationId === organizationId
    )
    const webhookId = await backend.action(api.webhooks.create, {
      organizationId,
      endpoint: "https://example.test/qa-events",
      events: ["email.sent", "whatsapp.message.received"],
    })
    // Email and Meta template lists/editors, using retained fixtures where possible.
    const templates = backendRows<Doc<"templates">>("templates", 1000).filter(
      (r) => r.organizationId === organizationId
    )
    for (const channel of ["email", "messenger", "instagram"] as const) {
      if (!templates.some((r) => (r.channel ?? "email") === channel)) {
        const id = await backend.mutation(api.templates.create, {
          organizationId,
          channel,
          name: `${channel} support reply`,
          subject: "Support update",
          html: "<p>Thanks for contacting support.</p>",
          text: "Thanks for contacting support.",
          ...(channel !== "email"
            ? {
                content: {
                  text: "Thanks for contacting support.",
                  quick_replies: [
                    { title: "Support hours", payload: "support" },
                    { title: "Contact support", payload: "support" },
                  ],
                },
              }
            : {}),
        })
        templates.push({ _id: id, channel } as Doc<"templates">)
      }
    }
    const screens: Screen[] = []
    const route = (name: string, path: string, after?: Screen["open"]) =>
      screens.push({
        name,
        open: async (p) => {
          await p.goto(path)
          if (after) await after(p)
        },
      })
    for (const [name, path] of [
      ["sending", "/emails"],
      ["receiving", "/emails/receiving"],
    ]) {
      for (const channel of channels)
        route(
          `messages-${name}-${channel.toLowerCase().replaceAll(" ", "-")}`,
          path,
          (p) => choose(p, "Filter by channel", channel)
        )
    }
    expect(emails.length).toBeGreaterThan(0)
    route("message-email-detail", `/emails/${emails[0]._id}`)
    expect(received.length).toBeGreaterThan(0)
    route(
      "message-email-received-detail",
      `/emails/receiving/${received[0]._id}`
    )
    for (const channel of ["whatsapp", "messenger", "instagram"]) {
      const message = messages.find((r) => r.channel === channel)
      expect(message, `${channel} seeded message`).toBeTruthy()
      route(
        `message-${channel}-detail`,
        `/emails/messages/${message!._id}`,
        async (p) => {
          const identity = backendRows<Doc<"channelContacts">>(
            "channelContacts",
            1000
          ).find((r) => r._id === message!.channelContactId)
          if (
            channel !== "whatsapp" &&
            (identity?.username || identity?.profileName)
          ) {
            const name = identity.username
              ? `@${identity.username.replace(/^@/, "")}`
              : identity.profileName!
            await expect(
              p.getByRole("heading", { name, exact: true })
            ).toBeVisible()
          }
        }
      )
    }
    route("channels", "/channels")
    route("channels-add-menu", "/channels", async (p) => {
      await p
        .getByRole("button", { name: "Add channel", exact: true })
        .first()
        .click()
      await expect(p.getByRole("menu")).toBeVisible()
    })
    route("channel-domain-detail", `/domains/${sendingDomainId}`)
    for (const account of accounts)
      route(
        `channel-${account.channel}-detail-${accounts.indexOf(account)}`,
        `/channels/${account._id}`
      )
    route("settings-calling", `/channels/${whatsapp._id}`, async (p) => {
      await p
        .getByRole("button", { name: "Refresh settings", exact: true })
        .click()
      await expect(
        p.getByLabel("Calling status", { exact: true })
      ).toBeVisible()
    })
    for (const channel of channels)
      route(
        `templates-${channel.toLowerCase().replaceAll(" ", "-")}`,
        "/templates",
        (p) => choose(p, "Filter by channel", channel)
      )
    for (const channel of ["email", "whatsapp", "messenger", "instagram"]) {
      const template = templates.find((r) => (r.channel ?? "email") === channel)
      expect(template, `${channel} seeded template`).toBeTruthy()
      route(
        `template-${channel}-editor`,
        `/templates/${template!._id}`,
        async (p) => {
          await expect(
            p.getByRole("button", {
              name: "Send test",
              exact: true,
            })
          ).toBeVisible()
          if (channel === "messenger" || channel === "instagram")
            await expect(p.getByLabel("Body", { exact: true })).toBeVisible()
        }
      )
    }
    route("broadcasts", "/broadcasts")
    route("broadcast-editor", `/broadcasts/${draftId}/edit`, async (p) => {
      await expect(
        p.getByRole("button", { name: "Review", exact: true })
      ).toBeVisible()
      await expect(
        p.getByText("HTML code editor", { exact: true })
      ).toBeVisible()
    })
    route("broadcast-review", `/broadcasts/${draftId}/edit`, async (p) => {
      // React's Convex client sends actions on its existing WebSocket.
      // Hold the request itself so this verifies a real pending action.
      await p.evaluate(() => {
        const originalSend = WebSocket.prototype.send
        const held: (() => void)[] = []
        const qaWindow = window as Window & {
          qaAudienceHold?: { pending: () => number; release: () => void }
        }
        qaWindow.qaAudienceHold = {
          pending: () => held.length,
          release: () => {
            WebSocket.prototype.send = originalSend
            for (const send of held.splice(0)) send()
            delete qaWindow.qaAudienceHold
          },
        }
        WebSocket.prototype.send = function (this: WebSocket, data) {
          if (typeof data === "string") {
            try {
              const frame: unknown = JSON.parse(data)
              if (
                frame !== null &&
                typeof frame === "object" &&
                "type" in frame &&
                frame.type === "Action" &&
                "udfPath" in frame &&
                frame.udfPath === "broadcasts:review"
              ) {
                held.push(() => originalSend.call(this, data))
                return
              }
            } catch {
              // Other socket traffic keeps its normal transport behavior.
            }
          }
          originalSend.call(this, data)
        }
      })
      try {
        await p.getByRole("button", { name: "Review", exact: true }).click()
        await expect
          .poll(() =>
            p.evaluate(
              () =>
                (
                  window as Window & {
                    qaAudienceHold?: { pending: () => number }
                  }
                ).qaAudienceHold?.pending() ?? 0
            )
          )
          .toBe(1)
        await expect(p.getByTestId("review-check-recipients")).toHaveText(
          "Loading contacts…"
        )
        await expect(p.getByTestId("review-check-recipients")).toHaveAttribute(
          "data-level",
          "loading"
        )
        await expect(p.getByTestId("review-send")).toBeDisabled()
      } finally {
        await p.evaluate(() =>
          (
            window as Window & { qaAudienceHold?: { release: () => void } }
          ).qaAudienceHold?.release()
        )
      }
      await expect(p.getByTestId("review-check-recipients")).toHaveAttribute(
        "data-level",
        "ok"
      )
      await expect(
        p.getByText("Subject line added", { exact: true })
      ).toBeVisible()
    })
    const report = broadcasts.find((r) => r.status !== "draft")!
    expect(report, "Seeded broadcast report").toBeTruthy()
    route("broadcast-report", `/broadcasts/${report._id}`)
    route("automations", "/automations")
    route("automation-events", "/automations/events")
    route("automation-builder", `/automations/${automation._id}`)
    route(
      "automation-trigger-picker",
      `/automations/${automation._id}`,
      async (p) => {
        await p
          .getByTestId("workflow-node-start")
          .getByRole("button", {
            name: "WhatsApp message received",
            exact: true,
          })
          .click()
        await p
          .getByRole("combobox", { name: "Event picker", exact: true })
          .click()
        await expect(p.getByPlaceholder("Search events…")).toBeVisible()
      }
    )
    route(
      "automation-observability",
      `/automations/${automation._id}`,
      async (p) => {
        await p.getByTestId("view-toggle-observability").click()
        await p.getByTestId("run-row").first().click()
        await expect(p.getByTestId("workflow")).toContainText("Resolved inputs")
      }
    )
    for (const [name, path] of [
      ["contacts", "/contacts"],
      ["properties", "/properties"],
      ["segments", "/segments"],
      ["topics", "/topics"],
    ])
      route(`audience-${name}`, path)
    for (const tab of ["Details", "History"])
      route(
        `contact-${tab.toLowerCase()}`,
        `/contacts/${contact._id}`,
        async (p) => {
          await p.getByRole("tab", { name: tab, exact: true }).click()
        }
      )
    route("contact-channels", `/contacts/${contact._id}`, async (p) => {
      await p
        .getByRole("region", { name: "Contact channels", exact: true })
        .scrollIntoViewIfNeeded()
    })
    route("contact-notes", `/contacts/${contact._id}`, async (p) => {
      await p
        .getByRole("heading", { name: "Notes", exact: true })
        .scrollIntoViewIfNeeded()
    })
    route("call-with-bot-dialog", `/contacts/${contact._id}`, async (p) => {
      await p
        .getByRole("button", { name: "Call with bot", exact: true })
        .click()
      await expect(
        p.getByRole("dialog", { name: "Call with bot", exact: true })
      ).toBeVisible()
    })
    for (const channel of channels)
      route(
        `metrics-${channel.toLowerCase().replaceAll(" ", "-")}`,
        "/metrics",
        (p) => choose(p, "Channel", channel)
      )
    route("api-keys", "/api-keys")
    expect(keys.length).toBeGreaterThan(0)
    route("api-key-detail", `/api-keys/${keys[0]._id}`)
    route("api-key-custom-dialog", "/api-keys", async (p) => {
      await p
        .getByRole("button", { name: "Create API key", exact: true })
        .first()
        .click()
      await choose(p, "Permission", "Custom")
      await expect(
        p.getByText("Resource scopes", { exact: true })
      ).toBeVisible()
    })
    route("webhooks", "/webhooks")
    route("webhook-detail", `/webhooks/${webhookId}`)
    route("webhook-event-picker", "/webhooks", async (p) => {
      await p
        .getByRole("button", { name: "Add webhook", exact: true })
        .first()
        .click()
      await expect(p.getByRole("dialog")).toBeVisible()
    })
    route("logs", "/logs")
    expect(logs.length).toBeGreaterThan(0)
    route("log-detail", `/logs/${logs[0]._id}`)
    for (const [name, path] of [
      ["team", "/settings/team"],
      ["meta", "/instance/meta"],
      ["ses", "/instance/ses"],
      ["sso", "/settings/sso"],
      ["smtp", "/settings/smtp"],
      ["unsubscribe", "/settings/unsubscribe"],
      ["usage", "/settings/usage"],
      ["ai-providers", "/settings/ai-providers"],
      ["exports", "/settings/exports"],
    ])
      route(`settings-${name}`, path)
    for (const [name, path] of [
      ["calls", "/playground/calls"],
      ["inbox", "/playground/inbox"],
      ["ivrs", "/playground/ivr"],
      ["voice-bots", "/playground/voice-bot"],
      ["knowledge", "/playground/knowledge"],
      ["tools", "/playground/tools"],
    ])
      route(`playground-${name}`, path)
    route(
      "playground-call-transcript",
      `/playground/calls/${call._id}`,
      async (p) => {
        await expect(p.getByLabel("Transcript", { exact: true })).toContainText(
          "When is your support team available?"
        )
        const text = await p
          .getByLabel("Transcript", { exact: true })
          .innerText()
        expect(text.indexOf("When is")).toBeLessThan(
          text.indexOf("Our support")
        )
      }
    )
    route("playground-ivr-editor", `/playground/ivr/${ivrId}`)
    route("playground-voice-bot-detail", `/playground/voice-bot/${botId}`)
    route(
      "playground-knowledge-detail",
      `/playground/knowledge/${knowledge.id}`
    )
    route("playground-tool-edit", "/playground/tools", async (p) => {
      await p.getByRole("button", { name: "Edit", exact: true }).first().click()
      await expect(p.getByRole("dialog")).toBeVisible()
    })
    route("profile", "/profile")
    screens.push({
      name: "oauth-consent",
      open: async (p) => {
        await beginOAuth(p)
        await selectOAuthTeam(p, organizationId)
        await expect(
          p.getByRole("button", { name: "Authorize", exact: true })
        ).toBeEnabled()
      },
    })

    let runtime: string[] = []
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === "error") runtime.push(`console: ${message.text()}`)
    }
    const onError = (error: Error) =>
      runtime.push(`pageerror: ${error.message}`)
    page.on("console", onConsole)
    page.on("pageerror", onError)
    try {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 960 })
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme })
          // next-themes reads storage on navigation; force an actual persisted theme.
          await page.goto("/profile")
          await page.evaluate(
            (value) => localStorage.setItem("theme", value),
            theme
          )
          for (const screen of screens) {
            if (
              width === 390 &&
              [
                "automation-builder",
                "automation-trigger-picker",
                "automation-observability",
              ].includes(screen.name)
            ) {
              test.info().annotations.push({
                type: "fixme",
                description: `F05: ${screen.name} at 390px awaits the flow-editor branch (${theme})`,
              })
              continue
            }
            const screenshot = `${screen.name}-${theme}-${width}.png`
            runtime = []
            let openingError: string | undefined
            try {
              await screen.open(page)
              await expect(page.locator("html")).toHaveClass(
                new RegExp(`\\b${theme}\\b`)
              )
              // Workspace bootstrap uses plain text, before page skeletons mount.
              await expect(page.locator("body")).not.toContainText(
                "Loading your account",
                { timeout: 20_000 }
              )
              await expect(page.locator("body")).toContainText(/\S/)
              // Wait for reactive lists/details to load, not just server markup.
              await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(
                0,
                { timeout: 15_000 }
              )
              if (screen.name === "playground-inbox") {
                for (const row of await page
                  .getByTestId("conversation")
                  .all()) {
                  await expect(
                    row.locator('[data-slot="item-description"]')
                  ).not.toContainText(
                    /^\s*(?:You:\s*)?(?:hello_world|catalog_example|footer_example|call_permission)\s*$|\[template:|Template: /
                  )
                }
              }
              if (screen.name.startsWith("messages-")) {
                await expect(page.locator("body")).not.toContainText(
                  /\[template:|Template: (catalog_example|footer_example|call_permission|hello_world)|\+BSUID|\+US\./
                )
                if (width === 390) {
                  const labels = page.locator(
                    '[data-slot="table-body"] tr td:first-child a'
                  )
                  for (const label of await labels.all()) {
                    expect((await label.innerText()).trim()).not.toBe("")
                    await expect(label).toBeVisible()
                    const { width, visibleWidth } = await label.evaluate(
                      (el) => {
                        const text = el.getBoundingClientRect()
                        const slot = el.parentElement!.getBoundingClientRect()
                        return {
                          width: text.width,
                          visibleWidth: Math.max(
                            0,
                            Math.min(text.right, slot.right, innerWidth) -
                              Math.max(text.left, slot.left, 0)
                          ),
                        }
                      }
                    )
                    expect(
                      width,
                      "F02: party label occupies space"
                    ).toBeGreaterThan(0)
                    expect(
                      visibleWidth,
                      "F02: readable From/To text"
                    ).toBeGreaterThanOrEqual(Math.min(width, 80) - 1)
                  }
                }
              }
              if (width === 390) {
                for (const list of await page
                  .locator('[data-slot="tabs-list"]')
                  .all()) {
                  const first = list.getByRole("tab").first()
                  // A dialog makes its background tabs inaccessible. Active tabs
                  // may also scroll the strip; test reachability at its origin.
                  if (!(await first.count())) continue
                  const scrollLeft = await list.evaluate((el) => {
                    const previous = el.scrollLeft
                    el.scrollLeft = 0
                    return previous
                  })
                  try {
                    const [listBox, firstBox] = await Promise.all([
                      list.boundingBox(),
                      first.boundingBox(),
                    ])
                    if (listBox && firstBox)
                      expect(
                        firstBox.x,
                        "F07: first tab remains reachable at scroll origin"
                      ).toBeGreaterThanOrEqual(listBox.x - 1)
                  } finally {
                    await list.evaluate((el, previous) => {
                      el.scrollLeft = previous
                    }, scrollLeft)
                  }
                }
              }
              await page.evaluate(() => document.fonts.ready)
              await page.screenshot({
                path: join(dir, screenshot),
                animations: "disabled",
                fullPage: true,
              })
            } catch (error) {
              openingError = String(error)
              await page
                .screenshot({
                  path: join(dir, screenshot),
                  animations: "disabled",
                  fullPage: true,
                })
                .catch(() => {})
            }
            if (openingError)
              findings.push({
                screen: screen.name,
                theme,
                width,
                kind: "screen-error",
                detail: openingError,
                screenshot,
              })
            const evidence = await page.evaluate(() => {
              const overflow =
                (document.scrollingElement?.scrollWidth ?? 0) > innerWidth
              const offenders = overflow
                ? [...document.querySelectorAll("body *")]
                    .filter((el) => {
                      const r = el.getBoundingClientRect()
                      return (
                        r.width && (r.right > innerWidth + 1 || r.left < -1)
                      )
                    })
                    .slice(0, 30)
                    .map((el) => ({
                      tag: el.tagName,
                      class: el.className,
                      text: el.textContent?.slice(0, 100),
                    }))
                : []
              const raw = new Set<string>()
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT
              )
              while (walker.nextNode()) {
                const node = walker.currentNode,
                  el = node.parentElement
                if (
                  !el ||
                  el.closest(
                    'input, textarea, pre, code, script, style, [hidden], [aria-hidden="true"], [data-slot="json-viewer"], [data-testid*="payload"]'
                  ) ||
                  !el.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                  })
                )
                  continue
                const text = node.textContent ?? ""
                for (const token of text.match(
                  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z][a-z_]*(?:\.[a-z_]+)+\b/g
                ) ?? []) {
                  // Domain names and URLs are readable addresses, not machine labels.
                  if (
                    /\.(test|com|cc|dev|net|org|io)$/.test(token) ||
                    text.includes("https://") ||
                    text.includes("http://") ||
                    text.includes("@")
                  )
                    continue
                  raw.add(token)
                }
              }
              return {
                overflow,
                scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
                viewportWidth: innerWidth,
                offenders,
                raw: [...raw],
                crashed: document.body.innerText.includes(
                  "Something went wrong"
                ),
              }
            })
            if (width === 390 && evidence.overflow)
              findings.push({
                screen: screen.name,
                theme,
                width,
                kind: "overflow",
                detail: {
                  scrollWidth: evidence.scrollWidth,
                  viewportWidth: evidence.viewportWidth,
                  offenders: evidence.offenders,
                },
                screenshot,
              })
            if (evidence.crashed)
              findings.push({
                screen: screen.name,
                theme,
                width,
                kind: "error-boundary",
                detail: "Something went wrong",
                screenshot,
              })
            if (runtime.length)
              findings.push({
                screen: screen.name,
                theme,
                width,
                kind: "runtime-error",
                detail: [...runtime],
                screenshot,
              })
            if (evidence.raw.length)
              findings.push({
                screen: screen.name,
                theme,
                width,
                kind: "raw-code",
                detail: evidence.raw,
                screenshot,
              })
            visited.push(screenshot)
            writeFileSync(
              join(dir, "findings.json"),
              JSON.stringify({ visited, findings }, null, 2)
            )
          }
        }
      }
    } finally {
      page.off("console", onConsole)
      page.off("pageerror", onError)
      await context.close()
    }
    const failures = findings.filter((f) => f.kind !== "raw-code")
    expect(failures, `See ${join(dir, "findings.json")}`).toEqual([])
  })
}
