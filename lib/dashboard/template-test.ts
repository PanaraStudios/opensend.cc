import {
  componentsParameterFormat,
  storedComponents,
  templateVariables,
  variableLabel,
} from "../meta/templates"
import { normalizePhone } from "./phone"
import type { EmailTemplate } from "./types"

export function templateTestReady(
  item: Pick<EmailTemplate, "channel" | "status" | "whatsapp">
) {
  return (
    item.status === "published" &&
    (item.channel !== "whatsapp" || item.whatsapp?.metaStatus === "APPROVED")
  )
}
export function templateTestRecipient(channel: string, value: string): string {
  const recipient = value.trim()
  if (!recipient) throw new Error("Enter a recipient")
  if (channel !== "whatsapp") return recipient
  const phone = normalizePhone(recipient)
  if (!phone)
    throw new Error(
      "Enter a phone number with a country code, such as +15551234567"
    )
  return phone
}

/** Send variable keys match the existing channel send contract. */
export function templateTestVariables(
  item: Pick<EmailTemplate, "channel" | "components" | "variables">
) {
  if (item.channel !== "whatsapp")
    return item.variables.map((key) => ({
      key,
      label: `Variable {{{${key}}}}`,
    }))
  const components = storedComponents(item.components)
  return templateVariables(
    components,
    componentsParameterFormat(components)
  ).map((variable) => ({ key: variable.key, label: variableLabel(variable) }))
}
