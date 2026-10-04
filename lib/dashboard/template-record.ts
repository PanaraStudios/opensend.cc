import type { Doc } from "../../convex/_generated/dataModel"
import type { EmailTemplate } from "./types"
import { isPageChannel } from "../channels"
import { localTemplate } from "../meta/local-templates"

/** A template row, with its draft body where the caller has one. A
    WhatsApp draft's body is Meta's components. */
export function asTemplate(
  row: Doc<"templates">,
  body?: { html: string; content?: unknown; components?: unknown }
): EmailTemplate {
  if (row.channel === "whatsapp")
    return {
      ...asTemplate({ ...row, channel: undefined }, { html: "" }),
      channel: "whatsapp",
      ...(row.whatsapp ? { whatsapp: row.whatsapp } : {}),
      components: body?.components ?? [],
    }
  return {
    ...(row.channel ? { channel: row.channel } : {}),
    ...(isPageChannel(row.channel ?? "email")
      ? { localContent: localTemplate(body?.content, true) }
      : {}),
    id: row._id,
    name: row.name,
    alias: row.alias,
    subject: row.subject,
    preview: row.preview,
    html: body?.html ?? "",
    ...(!isPageChannel(row.channel ?? "email") && body?.content
      ? { content: body.content as EmailTemplate["content"] }
      : {}),
    ...(row.from ? { from: row.from } : {}),
    ...(row.replyTo ? { replyTo: row.replyTo } : {}),
    status: row.status,
    variables: row.variables,
    createdAt: row._creationTime,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt ?? null,
  }
}
