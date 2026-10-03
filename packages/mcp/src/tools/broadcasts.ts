import type { McpServer } from "@modelcontextprotocol/server"
import type { CreateBroadcastOptions, Opensend } from "@opensendcc/sdk"
import { z } from "zod"
import { EMAIL_HTML_RULES } from "../lib/email-html-rules.js"

const CREATE_BROADCAST_TOOL_BASE = {
  title: "Create Broadcast",
  description: `Create an email, WhatsApp, Messenger or Instagram broadcast draft. Messaging uses a template and connected sender. Messenger/Instagram sends only within the 24-hour window, without message tags. Use send-broadcast to send it.`,
} as const

const source = z.union([
  z.string(),
  z.object({ value: z.string(), fallback: z.string().optional() }),
  z.object({
    contact: z.enum(["firstName", "lastName", "email", "phone"]),
    fallback: z.string().optional(),
  }),
  z.object({ property: z.string(), fallback: z.string().optional() }),
])
const configuration = z.object({
  accountId: z.string().nonempty(),
  templateId: z.string().nonempty(),
  variables: z.record(z.string(), source),
})

let cachedCreateBroadcastSchemaKey: string | undefined
let cachedCreateBroadcastInputSchema: ReturnType<
  typeof buildCreateBroadcastInputSchema
>

function buildCreateBroadcastInputSchema(
  senderEmailAddress: string | undefined,
  replierEmailAddresses: string[]
) {
  return {
    channel: z.enum(["email", "whatsapp", "messenger", "instagram"]).optional(),
    whatsapp: configuration.optional(),
    messaging: configuration
      .optional()
      .describe(
        "Published Messenger/Instagram template and connected account. Sends only inside the 24-hour window; never uses message tags."
      ),
    name: z
      .string()
      .nonempty()
      .describe(
        "Name for the broadcast. If the user does not provide a name, go ahead and create a descriptive name for them, based on the email subject/content and the context of your conversation."
      ),
    segmentId: z.string().nonempty().describe("Segment ID to send to"),
    subject: z
      .string()
      .nonempty()
      .optional()
      .describe("Email subject (required for email)"),
    text: z
      .string()
      .optional()
      .describe(
        "Plain text version of the email content. The following placeholders may be used to personalize the email content: {{{FIRST_NAME|fallback}}}, {{{LAST_NAME|fallback}}}, {{{EMAIL}}}, {{{OPENSEND_UNSUBSCRIBE_URL}}} (the legacy {{{RESEND_UNSUBSCRIBE_URL}}} also works). If omitted, HTML will be used to generate it. Pass an empty string to disable automatic text generation."
      ),
    html: z
      .string()
      .optional()
      .describe(
        `HTML version of the email content. Placeholders: {{{FIRST_NAME|fallback}}}, {{{LAST_NAME|fallback}}}, {{{EMAIL}}}, {{{OPENSEND_UNSUBSCRIBE_URL}}} (the legacy {{{RESEND_UNSUBSCRIBE_URL}}} also works).\n\n${EMAIL_HTML_RULES}`
      ),
    previewText: z.string().optional().describe("Preview text for the email"),
    ...(!senderEmailAddress
      ? {
          from: z
            .string()
            .nonempty()
            .optional()
            .describe(
              'From email address (e.g. "sender@example.com" or "Opensend <sender@example.com>")'
            ),
        }
      : {}),
    ...(replierEmailAddresses.length === 0
      ? {
          replyTo: z
            .array(z.string())
            .optional()
            .describe("Reply-to email address(es)"),
        }
      : {}),
  }
}

function getCreateBroadcastInputSchema(
  senderEmailAddress: string | undefined,
  replierEmailAddresses: string[]
) {
  const key = `${senderEmailAddress ?? ""}|${replierEmailAddresses.join(",")}`
  if (cachedCreateBroadcastSchemaKey !== key) {
    cachedCreateBroadcastInputSchema = buildCreateBroadcastInputSchema(
      senderEmailAddress,
      replierEmailAddresses
    )
    cachedCreateBroadcastSchemaKey = key
  }
  return cachedCreateBroadcastInputSchema
}

const SEND_BROADCAST_TOOL = {
  title: "Send Broadcast",
  description: `**Purpose:** Send (or schedule) an existing broadcast by ID. The broadcast must have been created with create-broadcast first.

**NOT for:** Sending a new one-off email (use send-email). Not for creating the broadcast content (use create-broadcast).

**Returns:** Send confirmation and broadcast ID.

**When to use:**
- User has created a broadcast and says "send it", "go ahead and send", "schedule this for tomorrow"
- After create-broadcast; call send-broadcast with the returned ID to deliver to the audience
- Optional scheduledAt: natural language or ISO 8601 for scheduled send

**Workflow:** create-broadcast → send-broadcast. Use list-broadcasts to find existing draft/sent broadcasts.`,
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
    scheduledAt: z
      .string()
      .optional()
      .describe(
        'When to send the broadcast. Value may be in ISO 8601 format (e.g., 2024-08-05T11:52:01.858Z) or in natural language (e.g., "tomorrow at 10am", "in 2 hours", "next day at 9am PST", "Friday at 3pm ET"). If not provided, the broadcast will be sent immediately.'
      ),
  },
} as const

const LIST_BROADCASTS_TOOL = {
  title: "List Broadcasts",
  annotations: { readOnlyHint: true },
  description: `**Purpose:** List all broadcast campaigns (newsletters/bulk emails to audiences) with ID, name, audience, status, timestamps.

**NOT for:** Listing transactional emails (use list-emails). Not for listing segments or contacts (use list-segments, list-contacts).

**Returns:** For each broadcast: id, name, segment_id, status, created_at, scheduled_at, sent_at.

**When to use:** User asks "show my broadcasts", "what newsletters did I send?", "list campaigns". Use get-broadcast for full details of one.`,
  inputSchema: {},
} as const

const GET_BROADCAST_TOOL = {
  title: "Get Broadcast",
  annotations: { readOnlyHint: true },
  description:
    "Retrieve full details of a specific broadcast by ID, including HTML and plain text content.",
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
  },
} as const

const CANCEL_BROADCAST_TOOL = {
  title: "Cancel Broadcast",
  description: `**Purpose:** Cancel a queued or scheduled broadcast by ID, without removing it. Cancelling a queued broadcast stops it mid-send (emails already sent are not affected). Cancelling a scheduled broadcast reverts it to draft.

**NOT for:** Removing a broadcast entirely (use remove-broadcast). Draft and sent broadcasts cannot be cancelled — sent broadcasts are immutable, and drafts have nothing to cancel.

**When to use:** User wants to "stop", "cancel", or "pause" a broadcast that is currently sending or scheduled to send.`,
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
  },
} as const

const DUPLICATE_BROADCAST_TOOL = {
  title: "Duplicate Broadcast",
  description: `**Purpose:** Duplicate a broadcast by ID. Creates a new draft broadcast with the same segment, topic, sender, subject, reply-to, preview text, and content as the source, named after the source with " (copy)" appended (truncated to 70 characters). Any broadcast can be duplicated, including sent ones.

**NOT for:** Editing the source broadcast (use update-broadcast) or sending the copy (use send-broadcast on the new draft's ID).

**When to use:** User wants to "copy", "clone", "duplicate", or "reuse" an existing broadcast as the starting point for a new one.`,
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
  },
} as const

const REMOVE_BROADCAST_TOOL = {
  title: "Remove Broadcast",
  description:
    "Remove a broadcast by ID. Before using this tool, you MUST double-check with the user that they want to remove this broadcast. Reference the NAME of the broadcast when double-checking, and warn the user that removing a broadcast is irreversible. You may only use this tool if the user explicitly confirms they want to remove the broadcast after you double-check.",
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
  },
} as const

const UPDATE_BROADCAST_TOOL = {
  title: "Update Broadcast",
  description:
    "Update broadcast HTML/text and metadata in Opensend. Draft and canceled broadcasts accept content changes; other states allow name changes only.",
  inputSchema: {
    channel: z.enum(["email", "whatsapp", "messenger", "instagram"]).optional(),
    whatsapp: configuration.optional(),
    messaging: configuration.optional(),
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
    name: z.string().optional().describe("Name for the broadcast"),
    segmentId: z.string().optional().describe("Segment ID to send to"),
    from: z
      .string()
      .optional()
      .describe(
        'From email address (e.g. "sender@example.com" or "Opensend <sender@example.com>")'
      ),
    html: z
      .string()
      .optional()
      .describe(`HTML content of the email.\n\n${EMAIL_HTML_RULES}`),
    text: z.string().optional().describe("Plain text content of the email"),
    subject: z.string().optional().describe("Email subject"),
    replyTo: z
      .array(z.string())
      .optional()
      .describe("Reply-to email address(es)"),
    previewText: z.string().optional().describe("Preview text for the email"),
  },
} as const

const LIST_BROADCAST_CLICKED_LINKS_TOOL = {
  title: "List Broadcast Clicked Links",
  annotations: { readOnlyHint: true },
  description: `**Purpose:** List the links clicked in a broadcast, ranked by total clicks.

**Returns:** For each link: id (opaque pagination cursor for that row, not an entity id), url, clicks (total), unique_clicks. Use pagination (limit, after/before) for large lists.

**When to use:**
- User asks "what links were clicked in this broadcast?", "top clicked links", "click breakdown for this campaign"
- Use get-broadcast for overall broadcast details; use this for per-link click data.`,
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Number of links to retrieve. Default: 20, Max: 100, Min: 1"),
    after: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Cursor after which to retrieve more (for forward pagination). Cannot be used with "before".'
      ),
    before: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Cursor before which to retrieve more (for backward pagination). Cannot be used with "after".'
      ),
  },
} as const

const LIST_BROADCAST_RECIPIENTS_TOOL = {
  title: "List Broadcast Recipients",
  annotations: { readOnlyHint: true },
  description: `**Purpose:** List the individual recipients of a broadcast for a given event type (sent, delivered, opened, clicked, bounced, complained, unsubscribed, suppressed).

**NOT for:** Aggregate broadcast performance (use get-broadcast). Not for listing broadcasts themselves (use list-broadcasts). This tool returns per-recipient rows, one per contact per event type.

**Returns:** For each recipient: email, id (opaque pagination cursor), contact_id (when known). Also includes count for "opened"/"clicked", bounce_type for "bounced", and clicked_links (url + click count) for "clicked". Use pagination (limit, after/before) for large lists.

**When to use:** User asks "who opened this broadcast?", "who bounced?", "who clicked this link?", "who unsubscribed from this campaign?", or wants the list of contacts behind a specific broadcast engagement metric. Use get-broadcast first if you need the broadcast ID from a name.`,
  inputSchema: {
    broadcastId: z.string().nonempty().describe("Broadcast ID"),
    type: z
      .enum([
        "sent",
        "delivered",
        "opened",
        "clicked",
        "bounced",
        "complained",
        "unsubscribed",
        "suppressed",
      ])
      .describe("Recipient event type to list recipients for."),
    email: z
      .string()
      .optional()
      .describe("Filter recipients by a substring of their email address."),
    bounceType: z
      .enum(["permanent", "transient", "undetermined"])
      .optional()
      .describe(
        'Filter by bounce type. Only meaningful when "type" is "bounced".'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Number of recipients to retrieve. Default: 20, Max: 100, Min: 1"
      ),
    after: z
      .string()
      .nonempty()
      .optional()
      .describe(
        'Cursor to fetch the page after this recipient (for forward pagination). Cannot be used with "before".'
      ),
    before: z
      .string()
      .nonempty()
      .optional()
      .describe(
        'Cursor to fetch the page before this recipient (for backward pagination). Cannot be used with "after".'
      ),
  },
} as const

export function addBroadcastTools(
  server: McpServer,
  opensend: Opensend,
  {
    senderEmailAddress,
    replierEmailAddresses,
  }: {
    senderEmailAddress?: string
    replierEmailAddresses: string[]
  }
) {
  server.registerTool(
    "create-broadcast",
    {
      ...CREATE_BROADCAST_TOOL_BASE,
      inputSchema: getCreateBroadcastInputSchema(
        senderEmailAddress,
        replierEmailAddresses
      ),
    },
    async ({
      channel,
      whatsapp,
      messaging,
      name,
      segmentId,
      subject,
      text,
      html,
      previewText,
      from,
      replyTo,
    }) => {
      const fromEmailAddress = from ?? senderEmailAddress
      const replyToEmailAddresses = replyTo ?? replierEmailAddresses

      // Type check on from, since "from" is optionally included in the arguments schema
      // This should never happen.
      if (
        (!channel || channel === "email") &&
        typeof fromEmailAddress !== "string"
      ) {
        throw new Error("from argument must be provided.")
      }

      // Similar type check for "reply-to" email addresses.
      if (
        typeof replyToEmailAddresses !== "string" &&
        !Array.isArray(replyToEmailAddresses)
      ) {
        throw new Error("replyTo argument must be provided.")
      }

      let options: CreateBroadcastOptions
      if (channel && channel !== "email") {
        if (
          from !== undefined ||
          subject !== undefined ||
          html !== undefined ||
          text !== undefined ||
          replyTo !== undefined
        )
          throw new Error(
            "Messaging broadcasts use a template and sender account."
          )
        if (channel === "whatsapp") {
          if (!whatsapp || messaging)
            throw new Error("Provide whatsapp configuration.")
          options = { channel, whatsapp, name, segmentId }
        } else {
          if (!messaging || whatsapp)
            throw new Error("Provide messaging configuration.")
          options = { channel, messaging, name, segmentId }
        }
      } else if (typeof fromEmailAddress !== "string") {
        throw new Error("from argument must be provided.")
      } else if (!subject) {
        throw new Error("subject argument must be provided.")
      } else if (html) {
        options = {
          name,
          segmentId,
          subject,
          html,
          ...(text !== undefined && { text }),
          previewText,
          from: fromEmailAddress,
          replyTo: replyToEmailAddresses,
        }
      } else if (text !== undefined) {
        options = {
          name,
          segmentId,
          subject,
          text,
          previewText,
          from: fromEmailAddress,
          replyTo: replyToEmailAddresses,
        }
      } else {
        throw new Error(
          "either the html argument or the text argument must be provided."
        )
      }

      const response = await opensend.broadcasts.create(options)

      if (response.error) {
        throw new Error(
          `Failed to create broadcast: ${JSON.stringify(response.error)}`
        )
      }

      const resultContent: Array<{ type: "text"; text: string }> = [
        { type: "text", text: "Broadcast created successfully." },
        { type: "text", text: `ID: ${response.data.id}` },
      ]

      return { content: resultContent }
    }
  )

  server.registerTool(
    "send-broadcast",
    SEND_BROADCAST_TOOL,
    async ({ broadcastId: rawBroadcastId, scheduledAt }) => {
      const broadcastId = rawBroadcastId.trim()
      const response = await opensend.broadcasts.send(broadcastId, {
        scheduledAt,
      })

      if (response.error) {
        throw new Error(
          `Failed to send broadcast: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Broadcast sent successfully." },
          { type: "text", text: `ID: ${response.data.id}` },
        ],
      }
    }
  )

  server.registerTool(
    "list-broadcasts",
    LIST_BROADCASTS_TOOL,
    async (_args, _ctx) => {
      const response = await opensend.broadcasts.list()

      if (response.error) {
        throw new Error(
          `Failed to list broadcasts: ${JSON.stringify(response.error)}`
        )
      }

      const broadcasts = response.data.data
      return {
        content: [
          {
            type: "text",
            text: `Found ${broadcasts.length} broadcast${broadcasts.length === 1 ? "" : "s"}${broadcasts.length === 0 ? "." : ":"}`,
          },
          ...broadcasts.map(
            ({
              name,
              id,
              audience_id,
              status,
              created_at,
              scheduled_at,
              sent_at,
            }) => ({
              type: "text" as const,
              text: [
                `ID: ${id}`,
                `Name: ${name}`,
                audience_id !== null && `Segment ID: ${audience_id}`,
                `Status: ${status}`,
                `Created at: ${created_at}`,
                scheduled_at !== null && `Scheduled at: ${scheduled_at}`,
                sent_at !== null && `Sent at: ${sent_at}`,
              ]
                .filter(Boolean)
                .join("\n"),
            })
          ),
        ],
      }
    }
  )

  server.registerTool(
    "get-broadcast",
    GET_BROADCAST_TOOL,
    async ({ broadcastId: rawBroadcastId }) => {
      const broadcastId = rawBroadcastId.trim()
      const response = await opensend.broadcasts.get(broadcastId)

      if (response.error) {
        throw new Error(
          `Failed to get broadcast: ${JSON.stringify(response.error)}`
        )
      }

      const {
        id: responseId,
        name,
        audience_id,
        from,
        subject,
        reply_to,
        preview_text,
        status,
        created_at,
        scheduled_at,
        sent_at,
        html,
        text,
      } = response.data

      let details = [
        `ID: ${responseId}`,
        `Name: ${name}`,
        audience_id !== null && `Segment ID: ${audience_id}`,
        from !== null && `From: ${from}`,
        subject !== null && `Subject: ${subject}`,
        reply_to !== null && `Reply-to: ${reply_to.join(", ")}`,
        preview_text !== null && `Preview text: ${preview_text}`,
        `Status: ${status}`,
        `Created at: ${created_at}`,
        scheduled_at !== null && `Scheduled at: ${scheduled_at}`,
        sent_at !== null && `Sent at: ${sent_at}`,
      ]
        .filter(Boolean)
        .join("\n")

      details += `\n\n--- Plain Text Content ---\n${text || "(none)"}`
      if (html) {
        details += `\n\n--- HTML Content ---\n${html}`
      }

      return {
        content: [
          {
            type: "text",
            text: details,
          },
        ],
      }
    }
  )

  server.registerTool(
    "cancel-broadcast",
    CANCEL_BROADCAST_TOOL,
    async ({ broadcastId: rawBroadcastId }) => {
      const broadcastId = rawBroadcastId.trim()
      const response = await opensend.broadcasts.cancel(broadcastId)

      if (response.error) {
        throw new Error(
          `Failed to cancel broadcast: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Broadcast cancelled successfully." },
          { type: "text", text: `ID: ${response.data.id}` },
        ],
      }
    }
  )

  server.registerTool(
    "duplicate-broadcast",
    DUPLICATE_BROADCAST_TOOL,
    async ({ broadcastId: rawBroadcastId }) => {
      const broadcastId = rawBroadcastId.trim()
      const response = await opensend.broadcasts.duplicate(broadcastId)

      if (response.error) {
        throw new Error(
          `Failed to duplicate broadcast: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Broadcast duplicated successfully (draft)." },
          { type: "text", text: `New broadcast ID: ${response.data.id}` },
        ],
      }
    }
  )

  server.registerTool(
    "remove-broadcast",
    REMOVE_BROADCAST_TOOL,
    async ({ broadcastId: rawBroadcastId }) => {
      const broadcastId = rawBroadcastId.trim()
      const response = await opensend.broadcasts.remove(broadcastId)

      if (response.error) {
        throw new Error(
          `Failed to remove broadcast: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Broadcast removed successfully." },
          { type: "text", text: `ID: ${response.data.id}` },
        ],
      }
    }
  )

  server.registerTool(
    "update-broadcast",
    UPDATE_BROADCAST_TOOL,
    async ({
      broadcastId: rawBroadcastId,
      channel,
      whatsapp,
      messaging,
      name,
      segmentId,
      from,
      html,
      text,
      subject,
      replyTo,
      previewText,
    }) => {
      const broadcastId = rawBroadcastId.trim()
      // Fetch current broadcast to detect missing required fields.
      // The API validates the merged result (existing + patch), so updating
      // a dashboard-created broadcast that lacks `from` or `segment_id` will
      // fail unless we warn the user upfront.
      const current = await opensend.broadcasts.get(broadcastId)
      if (current.error) {
        throw new Error(
          `Failed to fetch broadcast: ${JSON.stringify(current.error)}`
        )
      }

      const missingFields: string[] = []
      if (
        (current.data.channel ?? "email") === "email" &&
        !current.data.from &&
        !from
      ) {
        missingFields.push("from")
      }
      if (
        (current.data.channel ?? "email") === "email" &&
        !current.data.audience_id &&
        !segmentId
      ) {
        missingFields.push("segmentId")
      }

      if (missingFields.length > 0) {
        const broadcast = current.data
        const state = [
          `ID: ${broadcast.id}`,
          `Name: ${broadcast.name ?? "(not set)"}`,
          `From: ${broadcast.from ?? "(not set)"}`,
          `Subject: ${broadcast.subject ?? "(not set)"}`,
          `Segment ID: ${broadcast.audience_id ?? "(not set)"}`,
          `Status: ${broadcast.status}`,
        ].join("\n")

        return {
          content: [
            {
              type: "text",
              text: `Cannot update: this broadcast is missing required fields: ${missingFields.join(", ")}.\n\nCurrent broadcast state:\n${state}\n\nCall list-segments and list-domains to load the available options, then present them to the user and ask which ones to use. Do NOT pick defaults on the user's behalf. Once the user chooses, retry this update with the missing fields included.`,
            },
          ],
        }
      }

      const response = await opensend.broadcasts.update(broadcastId, {
        channel,
        whatsapp,
        messaging,
        name,
        segmentId,
        from,
        html,
        text,
        subject,
        replyTo,
        previewText,
      })

      if (response.error) {
        throw new Error(
          `Failed to update broadcast: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Broadcast updated successfully." },
          { type: "text", text: `ID: ${broadcastId}` },
        ],
      }
    }
  )

  server.registerTool(
    "list-broadcast-clicked-links",
    LIST_BROADCAST_CLICKED_LINKS_TOOL,
    async ({ broadcastId: rawBroadcastId, limit, after, before }) => {
      if (after && before) {
        throw new Error(
          'Cannot use both "after" and "before" parameters. Use only one for pagination.'
        )
      }

      const broadcastId = rawBroadcastId.trim()
      const paginationOptions = after
        ? { limit, after }
        : before
          ? { limit, before }
          : limit !== undefined
            ? { limit }
            : undefined

      const response = await opensend.broadcasts.clickedLinks(
        broadcastId,
        paginationOptions
      )

      if (response.error) {
        throw new Error(
          `Failed to list broadcast clicked links: ${JSON.stringify(response.error)}`
        )
      }

      const links = response.data?.data ?? []
      const hasMore = response.data?.has_more ?? false

      if (links.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No clicked links found for this broadcast.",
            },
          ],
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Found ${links.length} clicked link${links.length === 1 ? "" : "s"}:`,
          },
          ...links.map(({ id, url, clicks, unique_clicks }) => ({
            type: "text" as const,
            text: `ID: ${id}\nURL: ${url}\nClicks: ${clicks}\nUnique clicks: ${unique_clicks}`,
          })),
          ...(hasMore
            ? [
                {
                  type: "text" as const,
                  text: before
                    ? 'There are more clicked links available. Use the "before" parameter with the first cursor to retrieve more.'
                    : 'There are more clicked links available. Use the "after" parameter with the last cursor to retrieve more.',
                },
              ]
            : []),
        ],
      }
    }
  )

  server.registerTool(
    "list-broadcast-recipients",
    LIST_BROADCAST_RECIPIENTS_TOOL,
    async ({
      broadcastId: rawBroadcastId,
      type,
      email,
      bounceType,
      limit,
      after,
      before,
    }) => {
      if (after && before) {
        throw new Error(
          'Cannot use both "after" and "before" parameters. Use only one for pagination.'
        )
      }
      if (bounceType !== undefined && type !== "bounced") {
        throw new Error('"bounceType" is only valid when type is "bounced".')
      }

      const broadcastId = rawBroadcastId.trim()

      const paginationOptions = after
        ? { limit, after }
        : before
          ? { limit, before }
          : limit !== undefined
            ? { limit }
            : {}

      const response = await opensend.broadcasts.recipients(broadcastId, {
        ...paginationOptions,
        type,
        ...(email !== undefined && { email }),
        ...(bounceType !== undefined && { bounceType }),
      })

      if (response.error) {
        throw new Error(
          `Failed to list broadcast recipients: ${JSON.stringify(response.error)}`
        )
      }

      const recipients = response.data?.data ?? []
      const hasMore = response.data?.has_more ?? false

      if (recipients.length === 0) {
        return {
          content: [{ type: "text", text: "No recipients found." }],
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Found ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}:`,
          },
          ...recipients.map((recipient) => ({
            type: "text" as const,
            text: [
              `Email: ${recipient.email}`,
              `ID: ${recipient.id}`,
              recipient.contact_id !== null &&
                `Contact ID: ${recipient.contact_id}`,
              "count" in recipient &&
                recipient.count !== undefined &&
                `Count: ${recipient.count}`,
              "bounce_type" in recipient &&
                recipient.bounce_type !== undefined &&
                recipient.bounce_type !== null &&
                `Bounce type: ${recipient.bounce_type}`,
              "clicked_links" in recipient &&
                recipient.clicked_links !== undefined &&
                `Clicked links: ${recipient.clicked_links.map((link) => `${link.url} (${link.clicks} click${link.clicks === 1 ? "" : "s"})`).join(", ")}`,
            ]
              .filter(Boolean)
              .join("\n"),
          })),
          ...(hasMore
            ? [
                {
                  type: "text" as const,
                  text: before
                    ? 'There are more recipients available. Use the "before" parameter with the first ID shown above to retrieve earlier recipients.'
                    : 'There are more recipients available. Use the "after" parameter with the last ID shown above to retrieve more.',
                },
              ]
            : []),
        ],
      }
    }
  )
}
