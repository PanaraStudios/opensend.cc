import { callingRoutingMembers, type CallingRouting } from "@opensendcc/sdk"
import type { McpServer } from "@modelcontextprotocol/server"
import type {
  Opensend,
  ConnectWhatsAppCall,
  PlaceWhatsAppCall,
  UpdateCallingSettings,
  RequestCallPermission,
} from "@opensendcc/sdk"
import { z } from "zod"
import {
  channelOutput,
  channelPagination,
  channelPageCheck,
} from "./channelMessaging.js"
const callingRouting = z.union(
  Object.entries(callingRoutingMembers).map(([kind, fields]) =>
    z.strictObject({
      kind: z.literal(kind),
      ...Object.fromEntries(
        Object.keys(fields).map((field) => [field, z.string()])
      ),
    })
  )
) as z.ZodType<CallingRouting>
const permissionTemplate = z.object({
  name: z.string(),
  language: z.string(),
  components: z.array(z.record(z.string(), z.unknown())).optional(),
}) as z.ZodType<NonNullable<RequestCallPermission["template"]>>
const session = z.object({
  sdp_type: z.enum(["offer", "answer"]),
  sdp: z.string().max(98304),
})
const optIn = z.object({
  status: z.enum(["ENABLED", "DISABLED"]),
  purpose: z.string().max(250).optional(),
  announcement_language: z.string().optional(),
})
const options = {
  recording: optIn.optional(),
  transcription: optIn.optional(),
  biz_opaque_callback_data: z.string().max(512).optional(),
}
const status = z.enum(["ENABLED", "DISABLED"])
const calling = z.object({
  status: status.optional(),
  call_icon_visibility: z.enum(["DEFAULT", "DISABLE_ALL"]).optional(),
  callback_permission_status: status.optional(),
  call_icons: z
    .object({ restrict_to_user_countries: z.array(z.string().length(2)) })
    .optional(),
  audio: z
    .object({ additional_codecs: z.array(z.enum(["PCMA", "PCMU"])) })
    .optional(),
  call_hours: z
    .object({
      status,
      timezone_id: z.string().optional(),
      weekly_operating_hours: z
        .array(
          z.object({
            day_of_week: z.enum([
              "MONDAY",
              "TUESDAY",
              "WEDNESDAY",
              "THURSDAY",
              "FRIDAY",
              "SATURDAY",
              "SUNDAY",
            ]),
            open_time: z.string(),
            close_time: z.string(),
          })
        )
        .optional(),
      holiday_schedule: z
        .array(
          z.object({
            date: z.string(),
            start_time: z.string(),
            end_time: z.string(),
          })
        )
        .max(20)
        .optional(),
    })
    .optional(),
  voicemail: z
    .object({
      status,
      triggers: z.array(z.enum(["REJECT", "TIMEOUT"])).optional(),
      audio: z
        .object({
          default: z.object({
            announcement_media_id: z.union([z.string(), z.number()]).optional(),
            timeout_seconds: z.number().min(0).max(30),
          }),
        })
        .optional(),
    })
    .optional(),
})
export function addCallingTools(server: McpServer, opensend: Opensend) {
  const output = (result: { data: unknown; error: unknown }) =>
    channelOutput("WhatsApp calling", result)
  server.registerTool(
    "list-whatsapp-calls",
    {
      title: "List WhatsApp Calls",
      description:
        "List the team's voice call log with cursor pagination. phoneNumberId scopes results to one sending number.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ...channelPagination,
        phoneNumberId: z.string().optional(),
      },
    },
    async (input) => {
      channelPageCheck(input)
      return output(
        await opensend.whatsapp.calls.list(
          input as Parameters<typeof opensend.whatsapp.calls.list>[0]
        )
      )
    }
  )
  server.registerTool(
    "get-whatsapp-call",
    {
      title: "Get WhatsApp Call",
      description:
        "Retrieve call lifecycle, BSUID identity, event timeline and recording/transcript download URLs. API mode includes remote SDP.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) => output(await opensend.whatsapp.calls.get(id))
  )
  server.registerTool(
    "place-whatsapp-call",
    {
      title: "Place WhatsApp Bot or IVR Call",
      description:
        "Call a CRM contact or phone using a voice bot or IVR. The bot starts with its greeting and receives context and variables. Missing permission returns a status; optionally queue a request and call after approval. Meta enforces expiry, quotas and country restrictions. Scope: calling:write.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        from: z.string(),
        to: z.string().optional(),
        contact_id: z.string().optional(),
        recipient: z.string().optional(),
        route: z.string().regex(/^(bot|ivr):.+$/),
        context: z.string().max(4000).optional(),
        variables: z.record(z.string(), z.string()).optional(),
        request_permission: z.boolean().optional(),
        permission_text: z.string().optional(),
        permission_template: permissionTemplate.optional(),
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ idempotencyKey, ...input }) => {
      if (!input.to && !input.contact_id && !input.recipient)
        throw new Error("Supply to, contact_id or recipient.")
      return output(
        await opensend.whatsapp.calls.place(input as PlaceWhatsAppCall, {
          idempotencyKey,
        })
      )
    }
  )
  server.registerTool(
    "get-contact-call-permission",
    {
      title: "Get Contact Calling Permission",
      description:
        "Read current permission and Meta's limits for this contact and WhatsApp number.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string(), from: z.string().optional() },
    },
    async ({ id, from }) =>
      output(
        await opensend.whatsapp.callPermissions.getForContact(id, { from })
      )
  )
  server.registerTool(
    "request-contact-call-permission",
    {
      title: "Request Contact Calling Permission",
      description:
        "Queue a calling permission request inside the messaging window. Meta's limits are checked before queuing. Scope: calling:write.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        id: z.string(),
        from: z.string().optional(),
        text: z.string().optional(),
        template: permissionTemplate.optional(),
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ id, idempotencyKey, ...input }) =>
      output(
        await opensend.whatsapp.callPermissions.requestForContact(id, input, {
          idempotencyKey,
        })
      )
  )
  server.registerTool(
    "connect-whatsapp-call",
    {
      title: "Connect WhatsApp Call",
      description:
        "Start a business-initiated call after the user grants permission. Use gateway for our media or api with a complete SDP offer. from is required when the team has several numbers. Meta enforces calling-country and permission limits.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        recipient: z.string().optional(),
        route: z.enum(["api", "gateway"]).optional(),
        session: session.optional(),
        ...options,
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ idempotencyKey, ...input }) => {
      if (!input.to && !input.recipient)
        throw new Error("Supply to or recipient (BSUID).")
      if (input.route === "api" && input.session?.sdp_type !== "offer")
        throw new Error("API calls need an SDP offer.")
      return output(
        await opensend.whatsapp.calls.connect(input as ConnectWhatsAppCall, {
          idempotencyKey,
        })
      )
    }
  )
  for (const [name, method] of [
    ["pre-accept", "preAccept"],
    ["accept", "accept"],
    ["reject", "reject"],
    ["terminate", "terminate"],
  ] as const) {
    server.registerTool(
      `${name}-whatsapp-call`,
      {
        title: `${name} WhatsApp Call`,
        description:
          method === "preAccept"
            ? "Prepare an inbound call using a complete answer SDP. No media is released until accept succeeds."
            : method === "accept"
              ? "Accept an inbound call. API mode requires the same complete answer SDP as pre-accept; gateway mode uses its prepared answer and releases media after Meta acceptance."
              : `Send ${method} signaling for a call owned by this team and tear down gateway media.`,
        annotations: {
          readOnlyHint: false,
          destructiveHint: method === "terminate" || method === "reject",
          idempotentHint: true,
        },
        inputSchema: {
          id: z.string(),
          session: session.optional(),
          ...options,
          idempotencyKey: z.string().optional(),
        },
      },
      async ({ id, idempotencyKey, ...input }) => {
        if (input.session && input.session.sdp_type !== "answer")
          throw new Error("Acceptance requires an SDP answer.")
        return output(
          method === "reject" || method === "terminate"
            ? await opensend.whatsapp.calls[method](id, { idempotencyKey })
            : await opensend.whatsapp.calls[method](
                id,
                input as Parameters<typeof opensend.whatsapp.calls.accept>[1],
                { idempotencyKey }
              )
        )
      }
    )
  }
  server.registerTool(
    "get-whatsapp-calling",
    {
      title: "Get WhatsApp Calling Settings",
      description:
        "Read calling settings and handling mode for a team phone number.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      output(await opensend.whatsapp.phoneNumbers.getCalling(id))
  )
  for (const method of ["update", "patch"] as const)
    server.registerTool(
      `${method}-whatsapp-calling`,
      {
        title: "Update WhatsApp Calling Settings",
        description:
          "Enable or disable calls, set gateway/api mode, visibility, country restrictions, call hours, callback permission, voicemail and codecs. call_hours replaces the entire schedule; omitted holidays are removed. announcement_file_id uploads a finalized Ogg Opus file under 60 seconds for voicemail. SIP stays disabled.",
        annotations: { readOnlyHint: false },
        inputSchema: {
          id: z.string(),
          calling: calling.optional(),
          routing: callingRouting.optional(),
          handling_mode: z.enum(["api", "gateway"]).optional(),
          announcement_file_id: z.string().optional(),
          ...(method === "update"
            ? { idempotencyKey: z.string().optional() }
            : {}),
        },
      },
      async ({ id, idempotencyKey, ...input }) =>
        output(
          method === "patch"
            ? await opensend.whatsapp.phoneNumbers.patchCalling(
                id,
                input as UpdateCallingSettings
              )
            : await opensend.whatsapp.phoneNumbers.updateCalling(
                id,
                input as UpdateCallingSettings,
                {
                  idempotencyKey:
                    typeof idempotencyKey === "string"
                      ? idempotencyKey
                      : undefined,
                }
              )
        )
    )
  server.registerTool(
    "get-whatsapp-call-permissions",
    {
      title: "Get WhatsApp Call Permissions",
      description:
        "Check live Meta permission and available actions/limits. Both Meta status vocabularies are preserved. Supply a BSUID recipient or to phone number.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        recipient: z.string().optional(),
      },
    },
    async (input) => {
      if (!input.to && !input.recipient)
        throw new Error("Supply to or recipient.")
      return output(await opensend.whatsapp.callPermissions.get(input))
    }
  )
  server.registerTool(
    "request-whatsapp-call-permission",
    {
      title: "Request WhatsApp Call Permission",
      description:
        "Queue a free-form call permission request inside the service window or use an approved call-permission template. Meta enforces request limits.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        recipient: z.string().optional(),
        text: z.string().optional(),
        template: permissionTemplate.optional(),
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ idempotencyKey, ...input }) => {
      if (!input.to && !input.recipient)
        throw new Error("Supply to or recipient.")
      if (
        Number(input.text !== undefined) +
          Number(input.template !== undefined) !==
        1
      )
        throw new Error("Supply text or a template.")
      return output(
        await opensend.whatsapp.callPermissions.request(
          input as RequestCallPermission,
          { idempotencyKey }
        )
      )
    }
  )
}
