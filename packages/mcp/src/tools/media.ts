import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { z } from "zod"
import { channelOutput } from "./channelMessaging.js"

export function addMediaTools(server: McpServer, client: Opensend) {
  server.registerTool(
    "create-media-upload",
    {
      title: "Create media upload",
      description:
        "Create a direct upload. PUT the file to upload_url (POST for provider convex), then complete it. Use the returned id in WhatsApp media or email attachments.",
      inputSchema: z.object({
        use: z.enum(["whatsapp", "template", "email", "import"]),
        filename: z.string(),
        content_type: z.string(),
        size: z.number().int().positive(),
        from: z.string().optional(),
        animated: z.boolean().optional(),
      }),
    },
    async (input) => channelOutput("Media", await client.media.create(input))
  )
  server.registerTool(
    "complete-media-upload",
    {
      title: "Complete media upload",
      description:
        "Verify a direct upload before using its id. Local Convex uploads also require storage_id from the upload response.",
      inputSchema: z.object({
        id: z.string(),
        storage_id: z.string().optional(),
      }),
    },
    async ({ id, storage_id }) =>
      channelOutput("Media", await client.media.complete(id, { storage_id }))
  )
}
