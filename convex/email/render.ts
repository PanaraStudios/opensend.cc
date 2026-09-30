import { toPlainText } from "@react-email/render"
import {
  escapeHtml,
  fillVariables,
} from "../../lib/dashboard/email-variables"

/* The editor exports finished HTML (React Email runs in the browser), so a
   send only fills merge tags. Every send path renders through here. */
export type EmailContent = { subject: string; html: string; text?: string }

/** One recipient's copy. Without an explicit plain-text part, one is
    derived from the filled HTML. */
export function renderEmail(
  content: EmailContent,
  values: Readonly<Record<string, string | undefined>>
) {
  const html = fillVariables(content.html, values, escapeHtml)
  return {
    subject: fillVariables(content.subject, values),
    html,
    text:
      content.text === undefined
        ? toPlainText(html)
        : fillVariables(content.text, values),
  }
}
