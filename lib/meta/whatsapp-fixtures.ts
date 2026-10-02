/** Real-shaped catalog fixtures shared by Convex, SDK, MCP and OpenAPI tests. */
import examples from "./whatsapp-fixtures.json" with { type: "json" }
export const whatsappSendExamples = examples.send as Record<
  string,
  Record<string, unknown>
>
export const whatsappInboundExamples = examples.inbound as Record<
  string,
  Record<string, unknown>
>
