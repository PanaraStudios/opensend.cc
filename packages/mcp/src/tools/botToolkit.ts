import type { McpServer } from "@modelcontextprotocol/server"
import type {
  Opensend,
  BotToolInput,
  KnowledgeDocumentInput,
} from "@opensendcc/sdk"
import { z } from "zod"
import {
  channelOutput,
  channelPagination,
  channelPageCheck,
} from "./channelMessaging.js"
export const collectSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(128),
  description: z.string().min(1).max(1000),
  type: z.enum(["text", "number", "boolean", "email", "phone", "date", "enum"]),
  options: z.array(z.string()).max(50).optional(),
  required: z.boolean(),
  contactProperty: z.string().optional(),
})
const parameters = z.object({
  type: z.literal("object"),
  properties: z.record(
    z.string(),
    z.object({
      type: z.enum(["string", "number", "boolean"]),
      description: z.string().optional(),
      enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
  ),
  required: z.array(z.string()).optional(),
  additionalProperties: z.literal(false).optional(),
})
const toolFields = {
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  description: z.string().min(1).max(2000),
  parameters,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  signingSecret: z.string().min(32).max(256).optional(),
  timeoutMs: z.number().int().min(100).max(10000).optional(),
  resultFields: z.array(z.string()).max(32).optional(),
}
const documentFields = {
  title: z.string().min(1).max(256),
  source: z.enum(["text", "url", "upload"]),
  text: z.string().max(200000).optional(),
  url: z.string().url().optional(),
  fileId: z.string().optional(),
}
export function addBotToolkitTools(server: McpServer, client: Opensend) {
  const output = (result: { data: unknown; error: unknown }) =>
    channelOutput("Bot toolkit", result)
  for (const resource of ["knowledge-base", "bot-tool"] as const) {
    const kb = resource === "knowledge-base",
      fields: z.ZodRawShape = kb
        ? { name: z.string().min(1), description: z.string().optional() }
        : toolFields
    server.registerTool(
      `create-${resource}`,
      {
        title: kb ? "Create Knowledge Base" : "Create Bot Tool",
        description: kb
          ? "Create a reusable team knowledge base."
          : "Create a signed HTTPS webhook tool. Headers and signing secrets are write-only.",
        annotations: { readOnlyHint: false, destructiveHint: false },
        inputSchema: { ...fields, idempotencyKey: z.string().optional() },
      },
      async ({ idempotencyKey, ...input }) =>
        output(
          kb
            ? await client.knowledgeBases.create(
                input as { name: string; description?: string },
                { idempotencyKey }
              )
            : await client.botTools.create(input as BotToolInput, {
                idempotencyKey,
              })
        )
    )
    server.registerTool(
      `list-${resource}s`,
      {
        title: kb ? "List Knowledge Bases" : "List Bot Tools",
        description: "List team resources with ID cursors.",
        annotations: { readOnlyHint: true },
        inputSchema: channelPagination,
      },
      async (input) => {
        channelPageCheck(input)
        return output(
          kb
            ? await client.knowledgeBases.list(
                input as Parameters<typeof client.knowledgeBases.list>[0]
              )
            : await client.botTools.list(
                input as Parameters<typeof client.botTools.list>[0]
              )
        )
      }
    )
    server.registerTool(
      `get-${resource}`,
      {
        title: "Get Resource",
        description: "Read a team resource without credentials.",
        annotations: { readOnlyHint: true },
        inputSchema: { id: z.string() },
      },
      async ({ id }) =>
        output(
          kb
            ? await client.knowledgeBases.get(id)
            : await client.botTools.get(id)
        )
    )
    server.registerTool(
      `update-${resource}`,
      {
        title: "Update Resource",
        description: "Patch configuration. Omitted secret fields are retained.",
        annotations: { readOnlyHint: false },
        inputSchema: { ...z.object(fields).partial().shape, id: z.string() },
      },
      async ({ id, ...input }) =>
        output(
          kb
            ? await client.knowledgeBases.update(
                id,
                input as Partial<{ name: string; description?: string }>
              )
            : await client.botTools.update(id, input as Partial<BotToolInput>)
        )
    )
    server.registerTool(
      `remove-${resource}`,
      {
        title: "Remove Resource",
        description: "Delete this team resource.",
        annotations: { readOnlyHint: false, destructiveHint: true },
        inputSchema: { id: z.string() },
      },
      async ({ id }) =>
        output(
          kb
            ? await client.knowledgeBases.remove(id)
            : await client.botTools.remove(id)
        )
    )
  }
  server.registerTool(
    "create-knowledge-document",
    {
      title: "Add Knowledge Document",
      description:
        "Ingest PDF/TXT/MD/DOCX from an existing media fileId, public HTTPS URL or pasted text.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        ...documentFields,
        knowledgeBaseId: z.string(),
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ knowledgeBaseId, idempotencyKey, ...input }) =>
      output(
        await client.knowledgeBases.documents.create(
          knowledgeBaseId,
          input as KnowledgeDocumentInput,
          { idempotencyKey }
        )
      )
  )
  server.registerTool(
    "list-knowledge-documents",
    {
      title: "List Knowledge Documents",
      description: "Read document processing statuses and failure reasons.",
      annotations: { readOnlyHint: true },
      inputSchema: { knowledgeBaseId: z.string(), ...channelPagination },
    },
    async ({ knowledgeBaseId, ...input }) => {
      channelPageCheck(input)
      return output(
        await client.knowledgeBases.documents.list(
          knowledgeBaseId,
          input as Parameters<typeof client.knowledgeBases.documents.list>[1]
        )
      )
    }
  )
  server.registerTool(
    "get-knowledge-document",
    {
      title: "Get Knowledge Document",
      description: "Retrieve a document in its knowledge base.",
      annotations: { readOnlyHint: true },
      inputSchema: { knowledgeBaseId: z.string(), id: z.string() },
    },
    async ({ knowledgeBaseId, id }) =>
      output(await client.knowledgeBases.documents.get(knowledgeBaseId, id))
  )
  server.registerTool(
    "update-knowledge-document",
    {
      title: "Update Knowledge Document",
      description: "Edit a document and re-index its contents.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        ...z.object(documentFields).partial().shape,
        knowledgeBaseId: z.string(),
        id: z.string(),
      },
    },
    async ({ knowledgeBaseId, id, ...input }) =>
      output(
        await client.knowledgeBases.documents.update(
          knowledgeBaseId,
          id,
          input as Partial<KnowledgeDocumentInput>
        )
      )
  )
  server.registerTool(
    "remove-knowledge-document",
    {
      title: "Remove Knowledge Document",
      description: "Delete a document, its chunks and retained upload.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: { knowledgeBaseId: z.string(), id: z.string() },
    },
    async ({ knowledgeBaseId, id }) =>
      output(await client.knowledgeBases.documents.remove(knowledgeBaseId, id))
  )
  server.registerTool(
    "search-knowledge",
    {
      title: "Search Knowledge",
      description:
        "Search only this team's knowledge base using its Gemini key.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string(),
        query: z.string().min(1).max(4096),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ id, ...input }) =>
      output(await client.knowledgeBases.search(id, input))
  )
  server.registerTool(
    "test-bot-tool",
    {
      title: "Send Test Request",
      description:
        "Execute a saved webhook tool with sample arguments. This can cause endpoint side effects.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        id: z.string(),
        arguments: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()])
        ),
      },
    },
    async ({ id, arguments: args }) =>
      output(await client.botTools.test(id, args))
  )
}
