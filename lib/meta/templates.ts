/* WhatsApp message templates, as Meta documents them (checked 2026-10-01):
   https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api
   https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
   https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components
   https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management
   https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages

   A draft stores Meta's creation-format components, examples included, so
   what the editor saves is what publishing sends and what a sync imports.
   The editor works on a flat form, converted both ways here. Everything
   in this module is pure: the dashboard, Convex and the send pipeline share
   it. */

export const TEMPLATE_CATEGORIES = [
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** WhatsAppBusinessHSMStatus, Meta's full list. */
export const TEMPLATE_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "LIMIT_EXCEEDED",
  "ARCHIVED",
  "PENDING_DELETION",
  "DELETED",
] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

/** WhatsAppBusinessHSMQualityScore. */
export const TEMPLATE_QUALITIES = ["GREEN", "YELLOW", "RED", "UNKNOWN"] as const
export type TemplateQuality = (typeof TEMPLATE_QUALITIES)[number]

/** How variables are written: `{{first_name}}` or `{{1}}`. Meta's default
    is positional. */
export const PARAMETER_FORMATS = ["named", "positional"] as const
export type ParameterFormat = (typeof PARAMETER_FORMATS)[number]

export const HEADER_FORMATS = [
  "NONE",
  "TEXT",
  "IMAGE",
  "VIDEO",
  "DOCUMENT",
] as const
export type HeaderFormat = (typeof HEADER_FORMATS)[number]
export type MediaFormat = Exclude<HeaderFormat, "NONE" | "TEXT">

export const BUTTON_TYPES = [
  "QUICK_REPLY",
  "URL",
  "PHONE_NUMBER",
  "COPY_CODE",
] as const
export type ButtonType = (typeof BUTTON_TYPES)[number]

/** Meta's documented limits. */
export const TEMPLATE_LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttons: 10,
  buttonText: 25,
  url: 2000,
  phone: 20,
  copyCode: 20,
  /** At most this many buttons of one type. */
  perType: { QUICK_REPLY: 10, URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1 },
} as const

/** Only APPROVED, REJECTED and PAUSED templates can be edited. */
export const EDITABLE_STATUSES: readonly TemplateStatus[] = [
  "APPROVED",
  "REJECTED",
  "PAUSED",
]

export const DEFAULT_TEMPLATE_NAME = "untitled_template"
export const DEFAULT_TEMPLATE_LANGUAGE = "en_US"
const NAME = /^[a-z0-9_]+$/
export const isTemplateName = (name: string) =>
  NAME.test(name) && name.length <= TEMPLATE_LIMITS.name

/** A template name Meta accepts, made from any text. */
export function templateNameFrom(text: string) {
  const name = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, TEMPLATE_LIMITS.name)
  return name || DEFAULT_TEMPLATE_NAME
}

/* ------------------------------------------------------------ components */

/** One of Meta's template components, in the creation format. Stored as
    Meta sends and accepts it; fields this module does not know survive. */
export type TemplateComponent = Record<string, unknown> & { type: string }
export type NamedExample = { param_name: string; example: string }

/** A button as the editor holds it. */
export type FormButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone: string }
  | { type: "COPY_CODE" }

/** Stored components, or none: a draft holds JSON from anywhere. */
export function storedComponents(content: unknown): TemplateComponent[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (item): item is TemplateComponent =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { type?: unknown }).type === "string"
  )
}

/** The editor's flat view of a template's components. */
export type TemplateForm = {
  headerFormat: HeaderFormat
  headerText: string
  /** A media header's sample: a public URL, or a handle Meta returned. */
  headerSample: string
  body: string
  footer: string
  buttons: FormButton[]
  /** Example values, by variable key (see `templateVariables`). */
  examples: Record<string, string>
}

export const EMPTY_TEMPLATE_FORM: TemplateForm = {
  headerFormat: "NONE",
  headerText: "",
  headerSample: "",
  body: "",
  footer: "",
  buttons: [],
  examples: {},
}

const PARAM = /\{\{\s*([^{}]*?)\s*\}\}/g
const POSITIONAL = /^[1-9]\d*$/
const NAMED = /^[a-z_]+$/

/** The parameter names in a text, in order, repeats kept. */
export const textParams = (text: string) =>
  [...text.matchAll(PARAM)].map((match) => match[1])

/** Named when any parameter is not a number. */
export function detectParameterFormat(texts: string[]): ParameterFormat {
  return texts.some((text) =>
    textParams(text).some((param) => !POSITIONAL.test(param))
  )
    ? "named"
    : "positional"
}

/** Replaces each `{{param}}` with `fill(param)`, or leaves it be. */
export function fillParams(
  text: string,
  fill: (param: string) => string | undefined
) {
  return text.replace(PARAM, (whole, param: string) => fill(param) ?? whole)
}

export const RENDERED_HEADER_FORMATS = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "DOCUMENT",
  "LOCATION",
  "PRODUCT",
] as const
export type RenderedTemplate = {
  header?: { format: (typeof RENDERED_HEADER_FORMATS)[number]; text?: string }
  body: string
  footer?: string
  buttons: { type: string; text: string; url?: string; code?: string }[]
  cards?: Omit<RenderedTemplate, "cards">[]
}

/** Snapshot the creation-format template with this send's wire parameters.
 * Missing values stay visible; template examples are never send values. */
export function renderTemplate(
  components: readonly TemplateComponent[],
  sendComponents: unknown = []
): RenderedTemplate {
  const sends = storedComponents(sendComponents)
  const fill = (type: string, source: unknown) => {
    const parameters = list(find(sends, type)?.parameters).map(record)
    return fillParams(text(source), (key) => {
      const parameter =
        parameters.find((item) => item.parameter_name === key) ??
        (POSITIONAL.test(key) && !parameters[Number(key) - 1]?.parameter_name
          ? parameters[Number(key) - 1]
          : undefined)
      if (!parameter) return undefined
      if (parameter.type === "text")
        return typeof parameter.text === "string" ? parameter.text : undefined
      const fallback = record(parameter[text(parameter.type)]).fallback_value
      return typeof fallback === "string" ? fallback : undefined
    })
  }
  const header = find(components, "HEADER")
  const format = RENDERED_HEADER_FORMATS.find(
    (item) => item === upper(header?.format)
  )
  const footer = text(find(components, "FOOTER")?.text)
  const carousel = list(find(components, "CAROUSEL")?.cards)
  const sentCards = list(find(sends, "CAROUSEL")?.cards).map(record)
  return {
    ...(format
      ? {
          header: {
            format,
            ...(format === "TEXT"
              ? { text: fill("HEADER", header?.text) }
              : {}),
          },
        }
      : {}),
    body: fill("BODY", find(components, "BODY")?.text),
    ...(footer ? { footer } : {}),
    buttons: list(find(components, "BUTTONS")?.buttons).map((raw, index) => {
      const button = record(raw)
      const type = upper(button.type)
      const known = BUTTON_TYPES.find((item) => item === type)
      const send = sends.find(
        (part) => upper(part.type) === "BUTTON" && Number(part.index) === index
      )
      const parameters = list(send?.parameters).map(record)
      const url =
        type === "PHONE_NUMBER"
          ? `tel:${text(button.phone_number) || text(button.phone)}`
          : fillParams(
              text(button.url),
              () => text(parameters[0]?.text) || undefined
            )
      const code = text(
        parameters.find((part) => part.type === "coupon_code")?.coupon_code
      )
      return {
        type,
        text: text(button.text) || (known ? buttonLabel(known) : type),
        ...(url && !url.includes("{{") && url !== "tel:" ? { url } : {}),
        ...(code ? { code } : {}),
      }
    }),
    ...(carousel.length
      ? {
          cards: carousel.map((raw, index) => {
            const card = record(raw)
            const sent = sentCards.find(
              (item) => Number(item.card_index) === index
            )
            return renderTemplate(
              storedComponents(card.components),
              sent?.components
            )
          }),
        }
      : {}),
  }
}

/** The editor uses example values through one adapter to the sent shape. */
export function renderedTemplateFromForm(form: TemplateForm): RenderedTemplate {
  const sendComponents: TemplateComponent[] = (["header", "body"] as const).map(
    (where) => ({
      type: where,
      parameters: unique(
        textParams(where === "header" ? form.headerText : form.body)
      ).map((param) => ({
        type: "text",
        parameter_name: param,
        text: formExample(form, where, param)?.trim() || `{{${param}}}`,
      })),
    })
  )
  form.buttons.forEach((button, index) => {
    const param = button.type === "URL" ? textParams(button.url)[0] : undefined
    const value = param
      ? formExample(form, "button", param, index)
      : button.type === "COPY_CODE"
        ? form.examples[COUPON_CODE_KEY]
        : undefined
    if (value)
      sendComponents.push({
        type: "button",
        index,
        parameters: [
          button.type === "COPY_CODE"
            ? { type: "coupon_code", coupon_code: value }
            : { type: "text", text: value },
        ],
      })
  })
  return renderTemplate(componentsFromForm(form), sendComponents)
}

const upper = (value: unknown) =>
  typeof value === "string" ? value.toUpperCase() : ""
const text = (value: unknown) => (typeof value === "string" ? value : "")
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const unique = <T>(values: T[]) => [...new Set(values)]

/** One variable a send fills in. Keys are what callers pass in
    `variables`: the parameter name in named templates; in positional ones,
    the body's `1`, `2`…, `header_1` for the header, and `button_{index}`
    for a URL button. `coupon_code` fills a copy-code button and
    `header_media` a media header's link. */
export type TemplateVariable = {
  key: string
  where: "header" | "body" | "button" | "header_media"
  /** The parameter as written: `first_name`, `1`. */
  param: string
  /** The button's position, for a button. */
  index?: number
}

const bodyKey = (param: string) => param
const headerKey = (param: string, format: ParameterFormat) =>
  format === "named" ? param : `header_${param}`
const buttonKey = (param: string, index: number, format: ParameterFormat) =>
  format === "named" ? param : `button_${index}`
export const COUPON_CODE_KEY = "coupon_code"
export const HEADER_MEDIA_KEY = "header_media"

/** A component by type, in any case. */
const find = (components: readonly TemplateComponent[], type: string) =>
  components.find((component) => upper(component.type) === type)

/** Every variable the template's components take, in the order Meta reads
    them: header, body, buttons. A named parameter used twice is one key. */
export function templateVariables(
  components: readonly TemplateComponent[],
  format: ParameterFormat
): TemplateVariable[] {
  const variables: TemplateVariable[] = []
  const header = find(components, "HEADER")
  if (header) {
    const headerFormat = upper(header.format)
    if (headerFormat === "TEXT")
      for (const param of unique(textParams(text(header.text))))
        variables.push({
          key: headerKey(param, format),
          where: "header",
          param,
        })
    else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat))
      variables.push({
        key: HEADER_MEDIA_KEY,
        where: "header_media",
        param: "",
      })
  }
  const body = find(components, "BODY")
  for (const param of unique(textParams(text(body?.text))))
    variables.push({ key: bodyKey(param), where: "body", param })
  list(find(components, "BUTTONS")?.buttons).forEach((raw, index) => {
    const button = record(raw)
    const type = upper(button.type)
    if (type === "URL")
      for (const param of unique(textParams(text(button.url))))
        variables.push({
          key: buttonKey(param, index, format),
          where: "button",
          param,
          index,
        })
    if (type === "COPY_CODE")
      variables.push({
        key: COUPON_CODE_KEY,
        where: "button",
        param: "",
        index,
      })
  })
  const seen = new Set<string>()
  return variables.filter((variable) =>
    seen.has(variable.key) ? false : (seen.add(variable.key), true)
  )
}

/* ------------------------------------------------------ form conversions */

/** The example a form holds for a parameter, by where it is written. */
export function formExample(
  form: TemplateForm,
  where: "header" | "body" | "button",
  param: string,
  index = 0
) {
  const format = formParameterFormat(form)
  return form.examples[
    where === "header"
      ? headerKey(param, format)
      : where === "body"
        ? bodyKey(param)
        : buttonKey(param, index, format)
  ]
}

/** The URL before its variable, which Meta puts at the end. */
const urlPrefix = (url: string) => url.split("{{")[0]

/** The form's components in Meta's creation format, examples included. */
export function componentsFromForm(form: TemplateForm): TemplateComponent[] {
  const format = formParameterFormat(form)
  const example = (key: string) => form.examples[key] ?? ""
  const components: TemplateComponent[] = []
  if (form.headerFormat === "TEXT") {
    const params = unique(textParams(form.headerText))
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: form.headerText,
      ...(params.length
        ? {
            example:
              format === "named"
                ? {
                    header_text_named_params: params.map((param) => ({
                      param_name: param,
                      example: example(headerKey(param, format)),
                    })),
                  }
                : {
                    header_text: params.map((param) =>
                      example(headerKey(param, format))
                    ),
                  },
          }
        : {}),
    })
  } else if (form.headerFormat !== "NONE")
    components.push({
      type: "HEADER",
      format: form.headerFormat,
      ...(form.headerSample.trim()
        ? { example: { header_handle: [form.headerSample.trim()] } }
        : {}),
    })
  const params = unique(textParams(form.body))
  components.push({
    type: "BODY",
    text: form.body,
    ...(params.length
      ? {
          example:
            format === "named"
              ? {
                  body_text_named_params: params.map((param) => ({
                    param_name: param,
                    example: example(bodyKey(param)),
                  })),
                }
              : { body_text: [params.map((param) => example(bodyKey(param)))] },
        }
      : {}),
  })
  if (form.footer.trim()) components.push({ type: "FOOTER", text: form.footer })
  if (form.buttons.length)
    components.push({
      type: "BUTTONS",
      buttons: form.buttons.map((button, index) => {
        switch (button.type) {
          case "QUICK_REPLY":
            return { type: "QUICK_REPLY", text: button.text }
          case "PHONE_NUMBER":
            return {
              type: "PHONE_NUMBER",
              text: button.text,
              phone_number: button.phone,
            }
          case "COPY_CODE":
            return { type: "COPY_CODE", example: example(COUPON_CODE_KEY) }
          case "URL": {
            const param = textParams(button.url)[0]
            // Meta wants the whole URL as the example, variable filled in.
            return {
              type: "URL",
              text: button.text,
              url: button.url,
              ...(param !== undefined
                ? {
                    example: [
                      `${urlPrefix(button.url)}${example(buttonKey(param, index, format))}`,
                    ],
                  }
                : {}),
            }
          }
        }
      }),
    })
  return components
}

/** The texts whose parameters decide the format. */
const formTexts = (form: TemplateForm) => [
  form.headerFormat === "TEXT" ? form.headerText : "",
  form.body,
  ...form.buttons.map((button) => (button.type === "URL" ? button.url : "")),
]
export const formParameterFormat = (form: TemplateForm) =>
  detectParameterFormat(formTexts(form))

/** The parameter format stored components are written in. */
export function componentsParameterFormat(
  components: readonly TemplateComponent[]
): ParameterFormat {
  const header = find(components, "HEADER")
  return detectParameterFormat([
    text(header?.text),
    text(find(components, "BODY")?.text),
    ...list(find(components, "BUTTONS")?.buttons).map((button) =>
      text(record(button).url)
    ),
  ])
}

const KNOWN = new Set(["HEADER", "BODY", "FOOTER", "BUTTONS"])

/** The editor's form for stored components. `supported` is false when they
    hold parts the form cannot show (a carousel, a location header, an OTP
    or flow button); such a template is read-only in the editor. */
export function formFromComponents(components: readonly TemplateComponent[]): {
  form: TemplateForm
  supported: boolean
} {
  const format = componentsParameterFormat(components)
  let supported = components.every((component) =>
    KNOWN.has(upper(component.type))
  )
  const examples: Record<string, string> = {}
  const header = find(components, "HEADER")
  const headerFormat = upper(header?.format)
  let form: TemplateForm = { ...EMPTY_TEMPLATE_FORM, examples }
  if (header) {
    if (headerFormat === "TEXT") {
      const example = record(header.example)
      const params = unique(textParams(text(header.text)))
      const named = list(example.header_text_named_params).map(record)
      params.forEach((param, i) => {
        examples[headerKey(param, format)] =
          format === "named"
            ? text(named.find((item) => item.param_name === param)?.example)
            : text(list(example.header_text)[i])
      })
      form = { ...form, headerFormat: "TEXT", headerText: text(header.text) }
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat))
      form = {
        ...form,
        headerFormat: headerFormat as MediaFormat,
        headerSample: text(list(record(header.example).header_handle)[0]),
      }
    else supported = false
  }
  const body = find(components, "BODY")
  if (body) {
    const example = record(body.example)
    const named = list(example.body_text_named_params).map(record)
    const positional = list(list(example.body_text)[0])
    unique(textParams(text(body.text))).forEach((param, i) => {
      examples[bodyKey(param)] =
        format === "named"
          ? text(named.find((item) => item.param_name === param)?.example)
          : text(positional[i])
    })
    form.body = text(body.text)
  }
  form.footer = text(find(components, "FOOTER")?.text)
  form.buttons = list(find(components, "BUTTONS")?.buttons).flatMap(
    (raw, index): FormButton[] => {
      const button = record(raw)
      switch (upper(button.type)) {
        case "QUICK_REPLY":
          return [{ type: "QUICK_REPLY", text: text(button.text) }]
        case "PHONE_NUMBER":
          return [
            {
              type: "PHONE_NUMBER",
              text: text(button.text),
              phone: text(button.phone_number),
            },
          ]
        case "COPY_CODE": {
          const example = Array.isArray(button.example)
            ? button.example[0]
            : button.example
          examples[COUPON_CODE_KEY] = text(example)
          return [{ type: "COPY_CODE" }]
        }
        case "URL": {
          const url = text(button.url)
          const param = textParams(url)[0]
          if (param !== undefined) {
            const example = text(list(button.example)[0])
            const prefix = urlPrefix(url)
            examples[buttonKey(param, index, format)] = example.startsWith(
              prefix
            )
              ? example.slice(prefix.length)
              : example
          }
          return [{ type: "URL", text: text(button.text), url }]
        }
        default:
          supported = false
          return []
      }
    }
  )
  return { form, supported }
}

/* ------------------------------------------------------------ validation */

export type TemplateDefinition = {
  name: string
  language: string
  category: string
  parameterFormat: ParameterFormat
  components: readonly TemplateComponent[]
}

const LANGUAGE = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/
export const isTemplateLanguage = (code: string) =>
  TEMPLATE_LANGUAGES.some(([known]) => known === code) || LANGUAGE.test(code)

function paramProblems(
  where: string,
  value: string,
  format: ParameterFormat,
  max = Infinity
) {
  const problems: string[] = []
  const params = textParams(value)
  if (unique(params).length > max)
    problems.push(`The ${where} can use at most ${max} variable`)
  for (const param of params)
    if (format === "named" ? !NAMED.test(param) : !POSITIONAL.test(param))
      problems.push(
        format === "named"
          ? `Variable {{${param}}} in the ${where} must use lowercase letters and underscores`
          : `Variable {{${param}}} in the ${where} must be a number like {{1}}`
      )
  if (format === "positional") {
    const numbers = unique(params).map(Number)
    if (numbers.some((number, i) => number !== i + 1))
      problems.push(
        `Number the ${where}'s variables in order, starting at {{1}}`
      )
  }
  if (/\}\}\s*\{\{/.test(value))
    problems.push(`Put text between the ${where}'s variables`)
  return problems
}

/** What Meta would refuse, found before calling it, as sentences for the
    dashboard and the API. Empty when the template can be submitted. */
export function templateProblems(template: TemplateDefinition): string[] {
  const problems: string[] = []
  const { components, parameterFormat: format } = template
  if (!isTemplateName(template.name))
    problems.push(
      "Use only lowercase letters, numbers and underscores in the name"
    )
  if (!isTemplateLanguage(template.language))
    problems.push("Choose a supported language")
  if (!TEMPLATE_CATEGORIES.some((category) => category === template.category))
    problems.push("Choose a category")
  if (components.some((component) => !KNOWN.has(upper(component.type))))
    problems.push("This template has parts the editor cannot submit")
  if (componentsParameterFormat(components) !== format)
    problems.push(
      format === "named"
        ? "Named templates use variables like {{first_name}}"
        : "Positional templates use variables like {{1}}"
    )
  const header = find(components, "HEADER")
  if (header) {
    const headerFormat = upper(header.format)
    if (headerFormat === "TEXT") {
      const value = text(header.text)
      if (!value.trim()) problems.push("Add header text")
      if (value.length > TEMPLATE_LIMITS.headerText)
        problems.push(
          `Keep the header to ${TEMPLATE_LIMITS.headerText} characters`
        )
      problems.push(...paramProblems("header", value, format, 1))
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
      if (!text(list(record(header.example).header_handle)[0]).trim())
        problems.push("Add a sample file URL for the media header")
    } else problems.push("Choose a header type")
  }
  const body = find(components, "BODY")
  const bodyText = text(body?.text)
  if (!bodyText.trim()) problems.push("Add body text")
  if (bodyText.length > TEMPLATE_LIMITS.body)
    problems.push(`Keep the body to ${TEMPLATE_LIMITS.body} characters`)
  problems.push(...paramProblems("body", bodyText, format))
  if (/^\s*\{\{|\}\}\s*$/.test(bodyText))
    problems.push("The body cannot start or end with a variable")
  const footer = text(find(components, "FOOTER")?.text)
  if (footer.length > TEMPLATE_LIMITS.footer)
    problems.push(`Keep the footer to ${TEMPLATE_LIMITS.footer} characters`)
  if (textParams(footer).length)
    problems.push("The footer cannot use variables")
  const buttons = list(find(components, "BUTTONS")?.buttons).map(record)
  if (buttons.length > TEMPLATE_LIMITS.buttons)
    problems.push(
      `A template can have at most ${TEMPLATE_LIMITS.buttons} buttons`
    )
  for (const type of BUTTON_TYPES) {
    const count = buttons.filter((button) => upper(button.type) === type).length
    if (count > TEMPLATE_LIMITS.perType[type])
      problems.push(
        `A template can have at most ${TEMPLATE_LIMITS.perType[type]} ${buttonLabel(type).toLowerCase()} button${TEMPLATE_LIMITS.perType[type] === 1 ? "" : "s"}`
      )
  }
  // Quick replies sit together, before or after the other buttons.
  const kinds = buttons.map((button) => upper(button.type) === "QUICK_REPLY")
  if (kinds.filter((kind, i) => i > 0 && kind !== kinds[i - 1]).length > 1)
    problems.push("Group the quick reply buttons together")
  for (const button of buttons) {
    const type = upper(button.type)
    const label = text(button.text)
    if (type !== "COPY_CODE") {
      if (!label.trim()) problems.push("Give every button a label")
      if (label.length > TEMPLATE_LIMITS.buttonText)
        problems.push(
          `Keep button labels to ${TEMPLATE_LIMITS.buttonText} characters`
        )
    }
    if (type === "URL") {
      const url = text(button.url)
      if (!/^https?:\/\/\S+$/.test(url))
        problems.push("Enter a URL starting with https:// for the URL button")
      if (url.length > TEMPLATE_LIMITS.url)
        problems.push(`Keep URLs to ${TEMPLATE_LIMITS.url} characters`)
      const params = textParams(url)
      if (params.length > 1 || (params.length && !/\}\}$/.test(url.trim())))
        problems.push("A URL can have one variable, at its end")
      problems.push(...paramProblems("URL", url, format, 1))
    }
    if (type === "PHONE_NUMBER") {
      const phone = text(button.phone_number)
      if (!/^\+?[0-9A-Za-z]{4,20}$/.test(phone.replace(/[\s()-]/g, "")))
        problems.push("Enter the phone number to call")
    }
    if (type === "COPY_CODE") {
      const example = text(
        Array.isArray(button.example) ? button.example[0] : button.example
      )
      if (example.length > TEMPLATE_LIMITS.copyCode)
        problems.push(
          `Keep the sample code to ${TEMPLATE_LIMITS.copyCode} characters`
        )
    }
    if (!BUTTON_TYPES.some((known) => known === type))
      problems.push("This template has a button the editor cannot submit")
  }
  // Meta requires an example for every variable.
  const { form } = formFromComponents(components)
  for (const variable of templateVariables(components, format))
    if (
      variable.where !== "header_media" &&
      !form.examples[variable.key]?.trim()
    )
      problems.push(`Add an example for ${variableLabel(variable)}`)
  return unique(problems)
}

/* --------------------------------------------------------------- sending */

export type SendParameter = Record<string, unknown> & { type: string }
/** A component of a template message, as `POST /{phone}/messages` takes it. */
export type SendComponent = {
  type: "header" | "body" | "button"
  sub_type?: "url" | "copy_code"
  index?: string
  parameters: SendParameter[]
}

/** A send left some variables out. */
export class TemplateVariablesMissing extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing template variables: ${missing.join(", ")}`)
    this.name = "TemplateVariablesMissing"
  }
}

/** The message's `template.components` for one send of a template: each
    variable (keyed as in `templateVariables`) becomes its parameter. A
    media header without `header_media` reuses its sample when that is a
    public URL. Throws TemplateVariablesMissing naming what is missing. */
export function templateSendComponents(
  components: readonly TemplateComponent[],
  format: ParameterFormat,
  values: Readonly<Record<string, string | number | undefined>>
): SendComponent[] {
  const missing: string[] = []
  const value = (key: string, fallback?: string) => {
    const given = Object.hasOwn(values, key) ? values[key] : undefined
    const filled =
      given === undefined || given === "" ? fallback : String(given)
    if (filled === undefined || filled === "") missing.push(key)
    return filled ?? ""
  }
  const textParam = (param: string, key: string): SendParameter => ({
    type: "text",
    ...(format === "named" ? { parameter_name: param } : {}),
    text: value(key),
  })
  const sends: SendComponent[] = []
  const variables = templateVariables(components, format)
  const header = find(components, "HEADER")
  const headerVariables = variables.filter(
    (variable) => variable.where === "header"
  )
  if (headerVariables.length)
    sends.push({
      type: "header",
      parameters: headerVariables.map((variable) =>
        textParam(variable.param, variable.key)
      ),
    })
  if (variables.some((variable) => variable.where === "header_media")) {
    const media = upper(header?.format).toLowerCase()
    const sample = text(list(record(header?.example).header_handle)[0])
    const link = value(
      HEADER_MEDIA_KEY,
      /^https:\/\//.test(sample) ? sample : undefined
    )
    sends.push({
      type: "header",
      parameters: [
        {
          type: media,
          [media]: link.startsWith("opensend-file:")
            ? { id: link.slice("opensend-file:".length) }
            : { link },
        },
      ],
    })
  }
  const bodyParams = unique(textParams(text(find(components, "BODY")?.text)))
  if (bodyParams.length)
    sends.push({
      type: "body",
      parameters: bodyParams.map((param) => textParam(param, bodyKey(param))),
    })
  list(find(components, "BUTTONS")?.buttons).forEach((raw, index) => {
    const button = record(raw)
    const type = upper(button.type)
    const param = textParams(text(button.url))[0]
    if (type === "URL" && param !== undefined)
      sends.push({
        type: "button",
        sub_type: "url",
        index: String(index),
        parameters: [textParam(param, buttonKey(param, index, format))],
      })
    if (type === "COPY_CODE")
      sends.push({
        type: "button",
        sub_type: "copy_code",
        index: String(index),
        parameters: [
          { type: "coupon_code", coupon_code: value(COUPON_CODE_KEY) },
        ],
      })
  })
  if (missing.length) throw new TemplateVariablesMissing(unique(missing))
  return sends
}

/* ------------------------------------------------------- reading Meta */

/** The fields a sync asks `GET /{waba}/message_templates` for. */
export const TEMPLATE_FIELDS =
  "id,name,language,category,status,components,rejected_reason,quality_score,parameter_format"

/** A template as Meta lists it, narrowed to what a sync stores. */
export type MetaTemplate = {
  id: string
  name: string
  language: string
  category: TemplateCategory
  status: TemplateStatus
  parameterFormat: ParameterFormat
  components: TemplateComponent[]
  rejectedReason?: string
  quality?: TemplateQuality
}

const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  values.find((known) => known === upper(value))

/** A rejection reason worth showing: Meta sends NONE for none. */
const reason = (value: unknown) => {
  const found = text(value).trim()
  return found && found !== "NONE" ? found : undefined
}

/** The templates of a list response's `data`; entries without an id, name
    or language are dropped. A category Meta added since (FREE_SERVICE)
    reads as utility, an unknown status as pending. */
export function readMetaTemplates(data: unknown): MetaTemplate[] {
  return list(data).flatMap((raw): MetaTemplate[] => {
    const item = record(raw)
    const id =
      text(item.id) || (typeof item.id === "number" ? String(item.id) : "")
    const name = text(item.name)
    const language = text(item.language)
    if (!id || !name || !language) return []
    const components = list(item.components).filter(
      (component): component is TemplateComponent =>
        typeof record(component).type === "string"
    )
    const format =
      text(item.parameter_format).toLowerCase() === "named"
        ? "named"
        : text(item.parameter_format).toLowerCase() === "positional"
          ? "positional"
          : componentsParameterFormat(components)
    const quality = oneOf(TEMPLATE_QUALITIES, record(item.quality_score).score)
    const rejectedReason = reason(item.rejected_reason)
    return [
      {
        id,
        name,
        language,
        category: oneOf(TEMPLATE_CATEGORIES, item.category) ?? "UTILITY",
        status: oneOf(TEMPLATE_STATUSES, item.status) ?? "PENDING",
        parameterFormat: format,
        components,
        ...(rejectedReason ? { rejectedReason } : {}),
        ...(quality ? { quality } : {}),
      },
    ]
  })
}

/** What a template webhook changes on the template it names. */
export type TemplateUpdate = {
  metaTemplateId: string
  metaStatus?: TemplateStatus
  /** A reason to show, or null to clear the last one. */
  rejectedReason?: string | null
  category?: TemplateCategory
  quality?: TemplateQuality
  /** The event does not say the status (an unarchive): sync the WABA. */
  resync?: boolean
}

export const TEMPLATE_WEBHOOK_FIELDS = [
  "message_template_status_update",
  "template_category_update",
  "message_template_quality_update",
] as const

/** Reads `message_template_status_update`, `template_category_update` and
    `message_template_quality_update` values; null for another field or a
    value without a template id. Flagged, locked and unlocked events keep
    the status; a reinstated template is approved again. */
export function readTemplateUpdate(
  field: string,
  value: Record<string, unknown>
): TemplateUpdate | null {
  const raw = value.message_template_id
  const metaTemplateId =
    typeof raw === "number" && Number.isFinite(raw) ? String(raw) : text(raw)
  if (!metaTemplateId) return null
  if (field === "message_template_status_update") {
    const event = upper(value.event)
    const status =
      event === "REINSTATED" ? "APPROVED" : oneOf(TEMPLATE_STATUSES, event)
    const category = oneOf(TEMPLATE_CATEGORIES, value.message_template_category)
    return {
      metaTemplateId,
      ...(status ? { metaStatus: status } : {}),
      ...(status === "REJECTED"
        ? {
            rejectedReason:
              reason(record(value.rejection_info).reason) ??
              reason(value.reason) ??
              null,
          }
        : status
          ? { rejectedReason: null }
          : {}),
      ...(category ? { category } : {}),
      ...(event === "UNARCHIVED" ? { resync: true } : {}),
    }
  }
  if (field === "template_category_update") {
    // Only a change that happened has a previous category.
    const category = oneOf(TEMPLATE_CATEGORIES, value.new_category)
    return {
      metaTemplateId,
      ...(value.previous_category !== undefined && category
        ? { category }
        : {}),
    }
  }
  if (field === "message_template_quality_update") {
    const quality = oneOf(TEMPLATE_QUALITIES, value.new_quality_score)
    return { metaTemplateId, ...(quality ? { quality } : {}) }
  }
  return null
}

/** Whether a template in this state can be sent. */
export const sendableStatus = (status: TemplateStatus | undefined) =>
  status === "APPROVED"

/* ---------------------------------------------------------------- labels */

export function buttonLabel(type: ButtonType) {
  switch (type) {
    case "QUICK_REPLY":
      return "Quick reply"
    case "URL":
      return "Visit website"
    case "PHONE_NUMBER":
      return "Call phone number"
    case "COPY_CODE":
      return "Copy offer code"
  }
}

/** A variable as people read it in the editor and in errors. */
export function variableLabel(variable: TemplateVariable) {
  if (variable.where === "header_media") return "the media header"
  if (variable.key === COUPON_CODE_KEY) return "the offer code"
  const where =
    variable.where === "button"
      ? `button ${(variable.index ?? 0) + 1}`
      : variable.where
  return `{{${variable.param}}} in the ${where}`
}

export const templateCategoryLabel = (category: string) =>
  category.charAt(0) + category.slice(1).toLowerCase()

/** The template languages Meta supports, as [code, name]. */
export const TEMPLATE_LANGUAGES: readonly (readonly [string, string])[] = [
  ["af", "Afrikaans"],
  ["sq", "Albanian"],
  ["ar", "Arabic"],
  ["ar_EG", "Arabic (EGY)"],
  ["ar_AE", "Arabic (UAE)"],
  ["ar_LB", "Arabic (LBN)"],
  ["ar_MA", "Arabic (MAR)"],
  ["ar_QA", "Arabic (QAT)"],
  ["az", "Azerbaijani"],
  ["be_BY", "Belarusian"],
  ["bn", "Bengali"],
  ["bn_IN", "Bengali (IND)"],
  ["bg", "Bulgarian"],
  ["ca", "Catalan"],
  ["zh_CN", "Chinese (CHN)"],
  ["zh_HK", "Chinese (HKG)"],
  ["zh_TW", "Chinese (TAI)"],
  ["hr", "Croatian"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["prs_AF", "Dari"],
  ["nl", "Dutch"],
  ["nl_BE", "Dutch (BEL)"],
  ["en", "English"],
  ["en_GB", "English (UK)"],
  ["en_US", "English (US)"],
  ["en_AE", "English (UAE)"],
  ["en_AU", "English (AUS)"],
  ["en_CA", "English (CAN)"],
  ["en_GH", "English (GHA)"],
  ["en_IE", "English (IRL)"],
  ["en_IN", "English (IND)"],
  ["en_JM", "English (JAM)"],
  ["en_MY", "English (MYS)"],
  ["en_NZ", "English (NZL)"],
  ["en_QA", "English (QAT)"],
  ["en_SG", "English (SGP)"],
  ["en_UG", "English (UGA)"],
  ["en_ZA", "English (ZAF)"],
  ["et", "Estonian"],
  ["fil", "Filipino"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["fr_BE", "French (BEL)"],
  ["fr_CA", "French (CAN)"],
  ["fr_CH", "French (CHE)"],
  ["fr_CI", "French (CIV)"],
  ["fr_MA", "French (MAR)"],
  ["ka", "Georgian"],
  ["de", "German"],
  ["de_AT", "German (AUT)"],
  ["de_CH", "German (CHE)"],
  ["el", "Greek"],
  ["gu", "Gujarati"],
  ["ha", "Hausa"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["hu", "Hungarian"],
  ["id", "Indonesian"],
  ["ga", "Irish"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["kn", "Kannada"],
  ["kk", "Kazakh"],
  ["rw_RW", "Kinyarwanda"],
  ["ko", "Korean"],
  ["ky_KG", "Kyrgyz (Kyrgyzstan)"],
  ["lo", "Lao"],
  ["lv", "Latvian"],
  ["lt", "Lithuanian"],
  ["mk", "Macedonian"],
  ["ms", "Malay"],
  ["ml", "Malayalam"],
  ["mr", "Marathi"],
  ["nb", "Norwegian"],
  ["ps_AF", "Pashto"],
  ["fa", "Persian"],
  ["pl", "Polish"],
  ["pt_BR", "Portuguese (BR)"],
  ["pt_PT", "Portuguese (POR)"],
  ["pa", "Punjabi"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["sr", "Serbian"],
  ["si_LK", "Sinhala"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["es", "Spanish"],
  ["es_AR", "Spanish (ARG)"],
  ["es_CL", "Spanish (CHL)"],
  ["es_CO", "Spanish (COL)"],
  ["es_CR", "Spanish (CRI)"],
  ["es_DO", "Spanish (DOM)"],
  ["es_EC", "Spanish (ECU)"],
  ["es_HN", "Spanish (HND)"],
  ["es_MX", "Spanish (MEX)"],
  ["es_PA", "Spanish (PAN)"],
  ["es_PE", "Spanish (PER)"],
  ["es_ES", "Spanish (SPA)"],
  ["es_UY", "Spanish (URY)"],
  ["sw", "Swahili"],
  ["sv", "Swedish"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["uz", "Uzbek"],
  ["vi", "Vietnamese"],
  ["zu", "Zulu"],
]
