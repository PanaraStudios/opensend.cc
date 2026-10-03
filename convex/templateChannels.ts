import type { PageChannel } from "../lib/channels"
import { ConvexError, type Infer } from "convex/values"
import type { Input } from "./templates"
import { channelValue } from "./tables/channels"
import { localTemplate } from "../lib/meta/local-templates"
import { pageMessageContent } from "../lib/meta/payloads"
import { object } from "../lib/meta/webhooks"
import {
  PARAMETER_FORMATS,
  TEMPLATE_CATEGORIES,
  componentsParameterFormat,
  isTemplateName,
} from "../lib/meta/templates"
import { storedComponents } from "./whatsapp/rows"
import { invalid } from "./api/caller"
import {
  enumField,
  objectBody,
  objectField,
  stringField,
  stringListField,
} from "./api/route"

export type TemplateChannel = Infer<typeof channelValue>
export const SUBMIT_TO_META =
  "WhatsApp templates are published by submitting them to Meta"

type Body = { html: string; text?: string; content?: unknown }
const EMAIL_FIELDS = [
  "subject",
  "preview",
  "html",
  "text",
  "from",
  "replyTo",
  "variableDefinitions",
  "replyToAddresses",
] as const
const apiFields: Record<string, string> = {
  replyTo: "reply_to",
  replyToAddresses: "reply_to",
  variableDefinitions: "variables",
}
const localFields = [
  "html",
  "subject",
  "from",
  "replyTo",
  "replyToAddresses",
  "whatsapp",
] as const
function normalizeLocal(input: Input, current?: unknown): Input {
  if (input.content === undefined && input.text === undefined) return input
  const content = localTemplate(
    current === undefined
      ? (input.content ?? { text: input.text ?? "" })
      : {
          ...localTemplate(current, true),
          ...(input.content !== undefined
            ? object(input.content)
            : { text: input.text }),
        },
    true
  )
  return { ...input, content, text: content.text }
}
type TemplateAdapter = {
  forbiddenFields: readonly string[]
  parseInput(input: Record<string, unknown>, required: boolean): Input
  normalizeContent(input: Input, current?: unknown): Input
  publishCheck(body: Body | null): void
}
function localPublish(body: Body | null, channel: PageChannel) {
  if (!body?.text?.trim())
    throw new ConvexError("Add content to this template before publishing")
  pageMessageContent(localTemplate(body.content), channel)
}
export const templateChannels: Record<TemplateChannel, TemplateAdapter> = {
  email: {
    forbiddenFields: ["whatsapp"],
    parseInput: emailInput,
    normalizeContent: (input) => input,
    publishCheck: (body) => {
      if (!body?.html.trim())
        throw new ConvexError("Add content to this template before publishing")
    },
  },
  whatsapp: {
    forbiddenFields: EMAIL_FIELDS,
    parseInput: whatsappInput,
    normalizeContent: (input) =>
      input.content === undefined
        ? input
        : { ...input, content: storedComponents(input.content) },
    publishCheck: () => {
      throw new ConvexError(SUBMIT_TO_META)
    },
  },
  messenger: {
    forbiddenFields: localFields,
    parseInput: (input, required) => localInput(input, required),
    normalizeContent: normalizeLocal,
    publishCheck: (body) => localPublish(body, "messenger"),
  },
  instagram: {
    forbiddenFields: localFields,
    parseInput: (input, required) => localInput(input, required),
    normalizeContent: normalizeLocal,
    publishCheck: (body) => localPublish(body, "instagram"),
  },
}
export function assertTemplateFields(
  channel: TemplateChannel,
  input: Input | Record<string, unknown>,
  api = false
) {
  const fields = templateChannels[channel].forbiddenFields
  const forbidden = fields.find((key) => {
    // These REST fields were never read by their channel parser.
    if (api && key === "preview") return false
    const name = api ? (apiFields[key] ?? key) : key
    return input[name as keyof typeof input] !== undefined
  })
  if (!forbidden) return
  if (api) {
    if (channel === "whatsapp")
      throw invalid(
        `WhatsApp templates have no \`${apiFields[forbidden] ?? forbidden}\` field.`
      )
    if (channel === "email")
      throw invalid("Only WhatsApp templates have a `whatsapp` field.")
    throw invalid("Messaging templates have no email or WhatsApp fields.")
  }
  if (forbidden === "whatsapp")
    throw new ConvexError("Only WhatsApp templates have WhatsApp settings")
  throw new ConvexError(
    channel === "whatsapp"
      ? "WhatsApp templates have no email fields"
      : "Messaging templates have no email fields"
  )
}
export function parseTemplateInput(
  body: string,
  required = false,
  channel?: TemplateChannel
): Input & { channel: TemplateChannel } {
  const input = objectBody(JSON.parse(body))
  const asked = enumField(
    input,
    "channel",
    channelValue.members.map((member) => member.value)
  )
  if (channel && asked && asked !== channel)
    throw invalid("A template's `channel` cannot change.")
  const resolved = channel ?? asked ?? "email"
  assertTemplateFields(resolved, input, true)
  return {
    ...templateChannels[resolved].parseInput(input, required),
    channel: resolved,
  }
}

/** A WhatsApp template's fields: its Meta name, the `whatsapp` settings
    and Meta's components. `parameter_format` must match the components'
    variables, which decide it. */
function whatsappInput(input: Record<string, unknown>, required: boolean) {
  const name = stringField(input, "name", required)
  if (name !== undefined && !isTemplateName(name))
    throw invalid(
      "WhatsApp template names use only lowercase letters, numbers and underscores."
    )
  const whatsapp = objectField(input, "whatsapp") ?? {}
  const category = whatsapp.category
  if (
    category !== undefined &&
    (typeof category !== "string" ||
      !TEMPLATE_CATEGORIES.some((known) => known === category.toUpperCase()))
  )
    throw invalid(
      "The `whatsapp.category` field must be MARKETING, UTILITY or AUTHENTICATION."
    )
  const format = enumField(whatsapp, "parameter_format", PARAMETER_FORMATS)
  const raw = whatsapp.components
  if (raw !== undefined && !Array.isArray(raw))
    throw invalid("The `whatsapp.components` field must be an array.")
  const components = raw === undefined ? undefined : storedComponents(raw)
  if (components && components.length !== raw!.length)
    throw invalid("Every component needs a `type`.")
  if (format && components && componentsParameterFormat(components) !== format)
    throw invalid(
      "The `whatsapp.parameter_format` does not match the components' variables."
    )
  return {
    name,
    alias: stringField(input, "alias"),
    ...(components ? { content: components } : {}),
    whatsapp: {
      ...(whatsapp.waba_id !== undefined
        ? { wabaId: stringField(whatsapp, "waba_id")! }
        : {}),
      ...(whatsapp.language !== undefined
        ? { language: stringField(whatsapp, "language")! }
        : {}),
      ...(typeof category === "string"
        ? {
            category:
              category.toUpperCase() as (typeof TEMPLATE_CATEGORIES)[number],
          }
        : {}),
    },
  } satisfies Input
}

function localInput(input: Record<string, unknown>, required: boolean): Input {
  const text = stringField(input, "text", required)
  const quick_replies = input.quick_replies
  return {
    name: stringField(input, "name", required),
    alias: stringField(input, "alias"),
    ...(input.text !== undefined || quick_replies !== undefined
      ? {
          content: {
            ...(input.text !== undefined ? { text } : {}),
            ...(quick_replies !== undefined ? { quick_replies } : {}),
          },
        }
      : {}),
    ...(input.text !== undefined ? { text } : {}),
  }
}
function emailInput(input: Record<string, unknown>, required: boolean): Input {
  const replyToAddresses = stringListField(input, "reply_to", {
    rejectNull: true,
    message: "Invalid `reply_to` field.",
    emptyString: true,
  })
  let variableDefinitions: Input["variableDefinitions"]
  if (input.variables !== undefined) {
    if (!Array.isArray(input.variables) || input.variables.length > 50)
      throw invalid("A template can use at most 50 variables.")
    variableDefinitions = input.variables.map((value) => {
      const variable = objectBody(value)
      const key = stringField(variable, "key", true)!
      const type = enumField(variable, "type", ["string", "number"])
      if (!type) throw invalid("Missing variable type.")
      const fallback = variable.fallback_value
      if (
        fallback !== undefined &&
        (typeof fallback !== type ||
          (typeof fallback === "number" && !Number.isFinite(fallback)))
      )
        throw invalid("The variable fallback must match its type.")
      return {
        key,
        type,
        ...(fallback === undefined ? {} : { fallback: String(fallback) }),
      }
    })
  }
  return {
    name: stringField(input, "name", required),
    html: stringField(input, "html", required),
    ...(input.html !== undefined ? { content: null } : {}),
    alias: stringField(input, "alias"),
    subject: stringField(input, "subject"),
    from: stringField(input, "from"),
    text: stringField(input, "text"),
    ...(replyToAddresses === undefined
      ? {}
      : { replyToAddresses, replyTo: replyToAddresses[0] ?? "" }),
    ...(variableDefinitions === undefined ? {} : { variableDefinitions }),
  }
}
