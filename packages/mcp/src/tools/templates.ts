import type { McpServer } from "@modelcontextprotocol/server"
import type {
  CreateTemplateOptions,
  Opensend,
  UpdateTemplateOptions,
} from "@opensend/sdk"
import { z } from "zod"
import { EMAIL_HTML_RULES } from "../lib/email-html-rules.js"

const templateVariableSchema = z.object({
  key: z
    .string()
    .nonempty()
    .describe(
      "The variable key. Recommend capitalizing (e.g., PRODUCT_NAME). NEVER include reserved names in this list: FIRST_NAME, LAST_NAME, EMAIL, RESEND_UNSUBSCRIBE_URL — they are automatically available and will cause a validation error if added."
    ),
  type: z
    .enum(["string", "number"])
    .describe('The variable type — either "string" or "number".'),
  fallbackValue: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .describe(
      "Default value used if the variable is not provided when sending."
    ),
})

const CREATE_TEMPLATE_TOOL = {
  title: "Create Template",
  description: `Create an email template in Opensend with HTML/text. Use publish-template before sending.`,
  inputSchema: {
    name: z.string().nonempty().describe("The name of the template."),
    html: z
      .string()
      .nonempty()
      .describe(
        `The HTML content of the template. Use triple-brace syntax for variables: {{{VARIABLE_NAME}}}.\n\n${EMAIL_HTML_RULES}`
      ),
    subject: z
      .string()
      .optional()
      .describe("Default email subject. Can be overridden when sending."),
    from: z
      .string()
      .optional()
      .describe(
        'Sender email address (e.g., "Your Name <sender@example.com>"). Can be overridden when sending.'
      ),
    replyTo: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Default Reply-to email address(es). Can be overridden when sending."
      ),
    text: z
      .string()
      .optional()
      .describe(
        "Plain text version of the message. If omitted, HTML will be used to generate it. Pass an empty string to disable automatic text generation."
      ),
    alias: z
      .string()
      .optional()
      .describe(
        "An alias for the template. Can be used instead of the ID to reference the template."
      ),
    variables: z
      .array(templateVariableSchema)
      .optional()
      .describe("Array of template variables (up to 50 per template)."),
  },
} as const

const LIST_TEMPLATES_TOOL = {
  title: "List Templates",
  annotations: { readOnlyHint: true },
  description:
    "List all email templates from Opensend. Returns template names, statuses, and aliases. Don't bother telling the user the IDs unless they ask for them.",
  inputSchema: {
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Number of templates to retrieve. Default: 20, Max: 100, Min: 1"
      ),
    after: z
      .string()
      .optional()
      .describe(
        'Template ID after which to retrieve more (for forward pagination). Cannot be used with "before".'
      ),
    before: z
      .string()
      .optional()
      .describe(
        'Template ID before which to retrieve more (for backward pagination). Cannot be used with "after".'
      ),
  },
} as const

const GET_TEMPLATE_TOOL = {
  title: "Get Template",
  annotations: { readOnlyHint: true },
  description:
    "Get an email template by ID, alias from Opensend. Returns full template details including HTML content, variables, and publish status.",
  inputSchema: {
    id: z.string().nonempty().describe("The template ID, alias"),
  },
} as const

const UPDATE_TEMPLATE_TOOL = {
  title: "Update Template",
  description: `Update template HTML/text and metadata in Opensend. Publish again to make changes available for sending.`,
  inputSchema: {
    id: z.string().nonempty().describe("The template ID, alias"),
    name: z.string().optional().describe("New name for the template."),
    html: z
      .string()
      .optional()
      .describe(`New HTML content for the template.\n\n${EMAIL_HTML_RULES}`),
    subject: z.string().optional().describe("New default email subject."),
    from: z.string().optional().describe("New sender email address."),
    replyTo: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("New Reply-to email address(es)."),
    text: z
      .string()
      .optional()
      .describe(
        "New plain text version of the message. Pass an empty string to disable automatic text generation."
      ),
    alias: z.string().optional().describe("New alias for the template."),
    variables: z
      .array(templateVariableSchema)
      .optional()
      .describe(
        "New array of template variables (replaces existing variables)."
      ),
  },
} as const

const REMOVE_TEMPLATE_TOOL = {
  title: "Remove Template",
  description:
    "Remove an email template by ID, alias from Opensend. Before using this tool, you MUST double-check with the user that they want to remove this template. Reference the NAME of the template when double-checking, and warn the user that removing a template is irreversible. You may only use this tool if the user explicitly confirms they want to remove the template after you double-check.",
  inputSchema: {
    id: z.string().nonempty().describe("The template ID, alias"),
  },
} as const

const PUBLISH_TEMPLATE_TOOL = {
  title: "Publish Template",
  description:
    "Publish an email template in Opensend. Templates must be published before they can be used for sending emails. Re-publishing a previously published template makes the latest changes live. Accepts a template ID, alias.",
  inputSchema: {
    id: z.string().nonempty().describe("The template ID, alias"),
  },
} as const

const DUPLICATE_TEMPLATE_TOOL = {
  title: "Duplicate Template",
  description:
    "Duplicate an existing email template in Opensend. Creates a new draft copy of the template with a new ID. Accepts a template ID, alias.",
  inputSchema: {
    id: z
      .string()
      .nonempty()
      .describe("The ID, alias of the template to duplicate."),
  },
} as const

export function addTemplateTools(server: McpServer, opensend: Opensend) {
  server.registerTool(
    "create-template",
    CREATE_TEMPLATE_TOOL,
    async ({ name, html, subject, from, replyTo, text, alias, variables }) => {
      const response = await opensend.templates.create({
        name,
        html,
        subject,
        from,
        replyTo,
        text,
        alias,
        variables,
      } as CreateTemplateOptions)

      if (response.error) {
        throw new Error(
          `Failed to create template: ${JSON.stringify(response.error)}`
        )
      }

      const resultContent: Array<{ type: "text"; text: string }> = [
        { type: "text", text: "Template created successfully (draft)." },
        { type: "text", text: `ID: ${response.data.id}` },
        {
          type: "text",
          text: "Use publish-template when ready for sending.",
        },
      ]

      return { content: resultContent }
    }
  )

  server.registerTool(
    "list-templates",
    LIST_TEMPLATES_TOOL,
    async ({ limit, after, before }) => {
      if (after && before) {
        throw new Error(
          'Cannot use both "after" and "before" parameters. Use only one for pagination.'
        )
      }

      const paginationOptions = after
        ? { limit, after }
        : before
          ? { limit, before }
          : limit !== undefined
            ? { limit }
            : undefined

      const response = await opensend.templates.list(paginationOptions)

      if (response.error) {
        throw new Error(
          `Failed to list templates: ${JSON.stringify(response.error)}`
        )
      }

      const templates = response.data?.data ?? []
      const hasMore = response.data?.has_more ?? false

      if (templates.length === 0) {
        return {
          content: [{ type: "text", text: "No templates found." }],
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Found ${templates.length} template${templates.length === 1 ? "" : "s"}:`,
          },
          ...templates.map((template) => ({
            type: "text" as const,
            text: `Name: ${template.name}\nStatus: ${template.status}\nAlias: ${template.alias ?? "none"}\nID: ${template.id}\nCreated at: ${template.created_at}`,
          })),
          ...(hasMore
            ? [
                {
                  type: "text" as const,
                  text: 'There are more templates available. Use the "after" parameter with the last ID to retrieve more.',
                },
              ]
            : []),
        ],
      }
    }
  )

  server.registerTool(
    "get-template",
    GET_TEMPLATE_TOOL,
    async ({ id: rawId }) => {
      const id = rawId.trim()
      const response = await opensend.templates.get(id)

      if (response.error) {
        throw new Error(
          `Failed to get template: ${JSON.stringify(response.error)}`
        )
      }

      const template = response.data
      const variablesText =
        template.variables && template.variables.length > 0
          ? template.variables
              .map(
                (v) =>
                  `  {{{${v.key}}}} (${v.type})${v.fallback_value != null ? ` — fallback: ${v.fallback_value}` : ""}`
              )
              .join("\n")
          : "none"

      return {
        content: [
          {
            type: "text",
            text: `Name: ${template.name}\nID: ${template.id}\nStatus: ${template.status}\nAlias: ${template.alias ?? "none"}\nSubject: ${template.subject ?? "none"}\nFrom: ${template.from ?? "none"}\nReply-to: ${template.reply_to ?? "none"}\nCreated at: ${template.created_at}\nUpdated at: ${template.updated_at}\nPublished at: ${template.published_at ?? "never"}`,
          },
          {
            type: "text",
            text: `Variables:\n${variablesText}`,
          },
          {
            type: "text",
            text: `HTML:\n${template.html}`,
          },
          ...(template.text
            ? [{ type: "text" as const, text: `Text:\n${template.text}` }]
            : []),
        ],
      }
    }
  )

  server.registerTool(
    "update-template",
    UPDATE_TEMPLATE_TOOL,
    async ({
      id: rawId,
      name,
      html,
      subject,
      from,
      replyTo,
      text,
      alias,
      variables,
    }) => {
      const id = rawId.trim()
      const response = await opensend.templates.update(id, {
        name,
        html,
        subject,
        from,
        replyTo,
        text,
        alias,
        variables,
      } as UpdateTemplateOptions)

      if (response.error) {
        throw new Error(
          `Failed to update template: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Template updated successfully." },
          { type: "text", text: `ID: ${id}` },
          {
            type: "text",
            text: "If the template was published, use publish-template to make the changes live.",
          },
        ],
      }
    }
  )

  server.registerTool(
    "remove-template",
    REMOVE_TEMPLATE_TOOL,
    async ({ id: rawId }) => {
      const id = rawId.trim()
      const response = await opensend.templates.remove(id)

      if (response.error) {
        throw new Error(
          `Failed to remove template: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Template removed successfully." },
          { type: "text", text: `ID: ${response.data.id}` },
        ],
      }
    }
  )

  server.registerTool(
    "publish-template",
    PUBLISH_TEMPLATE_TOOL,
    async ({ id: rawId }) => {
      const id = rawId.trim()
      const response = await opensend.templates.publish(id)

      if (response.error) {
        throw new Error(
          `Failed to publish template: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Template published successfully." },
          { type: "text", text: `ID: ${response.data.id}` },
        ],
      }
    }
  )

  server.registerTool(
    "duplicate-template",
    DUPLICATE_TEMPLATE_TOOL,
    async ({ id: rawId }) => {
      const id = rawId.trim()
      const response = await opensend.templates.duplicate(id)

      if (response.error) {
        throw new Error(
          `Failed to duplicate template: ${JSON.stringify(response.error)}`
        )
      }

      return {
        content: [
          { type: "text", text: "Template duplicated successfully (draft)." },
          { type: "text", text: `New template ID: ${response.data.id}` },
        ],
      }
    }
  )
}
