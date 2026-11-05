import { object, string } from "./webhooks"
import { quickReplies } from "./payloads"
import { usedVariables, fillVariables } from "../dashboard/email-variables"

export type LocalTemplate = {
  text: string
  quick_replies: { title: string; payload: string }[]
}
/** Drafts permit incomplete replies; publishing and sending remain strict. */
export function localTemplate(value: unknown, draft = false): LocalTemplate {
  const data = object(value)
  if (data.text !== undefined && typeof data.text !== "string")
    throw new Error("Template text must be a string.")
  const text = string(data.text)
  if (text.length > 2000)
    throw new Error("Template text must be at most 2000 characters.")
  return {
    text,
    quick_replies:
      data.quick_replies === undefined
        ? []
        : quickReplies(data.quick_replies, draft),
  }
}
export const localTemplateSource = (content: LocalTemplate) =>
  [
    content.text,
    ...content.quick_replies.flatMap((reply) => [reply.title, reply.payload]),
  ].join("\n")
export const localTemplateVariables = (content: LocalTemplate) =>
  usedVariables(localTemplateSource(content))
export function fillLocalTemplate(
  content: LocalTemplate,
  values: Readonly<Record<string, string | undefined>>
) {
  return {
    text: fillVariables(content.text, values),
    quick_replies: content.quick_replies.map((reply) => ({
      title: fillVariables(reply.title, values),
      payload: fillVariables(reply.payload, values),
    })),
  }
}
