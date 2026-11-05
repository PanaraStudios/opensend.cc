import { ConvexError } from "convex/values"
import { describe, expect, test } from "vitest"
import {
  SUBMIT_TO_META,
  assertTemplateFields,
  parseTemplateInput,
  templateChannels,
  type TemplateChannel,
} from "./templateChannels"

function rejection(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError)
    const data = (error as ConvexError<{ statusCode: number; message: string } | string>)
      .data
    if (typeof data === "string") return data
    const details = data
    expect(details.statusCode).toBe(422)
    return details.message ?? ""
  }
  throw new Error("expected a validation error")
}

const body = (value: unknown) => JSON.stringify(value)

describe("parseTemplateInput", () => {
  test("an email body keeps Resend fields and stringifies variable fallbacks", () => {
    expect(
      parseTemplateInput(
        body({
          name: "Welcome",
          html: "<p>Hi</p>",
          subject: "Hello",
          from: "Opensend <hello@example.test>",
          text: "Hi",
          alias: "welcome",
          reply_to: ["a@example.test", "b@example.test"],
          variables: [
            { key: "NAME", type: "string", fallback_value: "there" },
            { key: "COUNT", type: "number", fallback_value: 1 },
            { key: "BARE", type: "string" },
          ],
        }),
        true
      )
    ).toEqual({
      channel: "email",
      name: "Welcome",
      html: "<p>Hi</p>",
      content: null,
      alias: "welcome",
      subject: "Hello",
      from: "Opensend <hello@example.test>",
      text: "Hi",
      replyToAddresses: ["a@example.test", "b@example.test"],
      replyTo: "a@example.test",
      variableDefinitions: [
        { key: "NAME", type: "string", fallback: "there" },
        { key: "COUNT", type: "number", fallback: "1" },
        { key: "BARE", type: "string" },
      ],
    })
    expect(
      parseTemplateInput(body({ reply_to: "" })).replyToAddresses
    ).toEqual([])
  })

  test("email variables and reply_to reject the shapes the parser cannot store", () => {
    expect(rejection(() => parseTemplateInput(body({}), true))).toBe(
      "Missing `name` field."
    )
    expect(
      rejection(() =>
        parseTemplateInput(body({ name: "Welcome", html: 1 }), true)
      )
    ).toBe("The `html` field must be a string.")
    expect(
      rejection(() => parseTemplateInput(body({ variables: { key: "NAME" } })))
    ).toBe("A template can use at most 50 variables.")
    expect(
      rejection(() =>
        parseTemplateInput(
          body({
            variables: Array.from({ length: 51 }, (_, index) => ({
              key: `V${index}`,
              type: "string",
            })),
          })
        )
      )
    ).toBe("A template can use at most 50 variables.")
    expect(
      rejection(() =>
        parseTemplateInput(
          body({ variables: [{ key: "COUNT", fallback_value: 1 }] })
        )
      )
    ).toBe("Missing variable type.")
    expect(
      rejection(() =>
        parseTemplateInput(
          body({
            variables: [{ key: "COUNT", type: "number", fallback_value: "1" }],
          })
        )
      )
    ).toBe("The variable fallback must match its type.")
    expect(rejection(() => parseTemplateInput(body({ reply_to: null })))).toBe(
      "Invalid `reply_to` field."
    )
    expect(rejection(() => parseTemplateInput("[]"))).toBe(
      "The request body must be a JSON object."
    )
  })

  test("WhatsApp accepts Meta fields and refuses email fields", () => {
    expect(
      parseTemplateInput(
        body({
          channel: "whatsapp",
          name: "order_update",
          alias: "orders",
          whatsapp: {
            category: "utility",
            parameter_format: "positional",
            language: "en_US",
            waba_id: "100",
            components: [{ type: "BODY", text: "Hi {{1}}" }],
          },
        }),
        true
      )
    ).toEqual({
      channel: "whatsapp",
      name: "order_update",
      alias: "orders",
      content: [{ type: "BODY", text: "Hi {{1}}" }],
      whatsapp: {
        wabaId: "100",
        language: "en_US",
        category: "UTILITY",
      },
    })
    expect(
      parseTemplateInput(
        body({ channel: "whatsapp", name: "order_update", preview: "Hi" })
      ).whatsapp
    ).toEqual({})
    expect(
      rejection(() =>
        parseTemplateInput(body({ channel: "whatsapp", html: "<p>Hi</p>" }))
      )
    ).toMatch(/^WhatsApp templates have no `html`/)
    expect(
      rejection(() =>
        parseTemplateInput(body({ channel: "whatsapp", variables: [] }))
      )
    ).toMatch(/`variables`/)
    expect(
      rejection(() =>
        parseTemplateInput(body({ channel: "whatsapp", name: "Order Update" }))
      )
    ).toBe(
      "WhatsApp template names use only lowercase letters, numbers and underscores."
    )
    expect(
      rejection(() =>
        parseTemplateInput(
          body({
            channel: "whatsapp",
            whatsapp: { category: "promo" },
          })
        )
      )
    ).toBe(
      "The `whatsapp.category` field must be MARKETING, UTILITY or AUTHENTICATION."
    )
    expect(
      rejection(() =>
        parseTemplateInput(
          body({
            channel: "whatsapp",
            whatsapp: { components: { type: "BODY" } },
          })
        )
      )
    ).toBe("The `whatsapp.components` field must be an array.")
    expect(
      rejection(() =>
        parseTemplateInput(
          body({
            channel: "whatsapp",
            whatsapp: { components: [{ text: "Hi" }] },
          })
        )
      )
    ).toBe("Every component needs a `type`.")
    expect(
      rejection(() =>
        parseTemplateInput(
          body({
            channel: "whatsapp",
            whatsapp: {
              parameter_format: "positional",
              components: [{ type: "BODY", text: "Hi {{name}}" }],
            },
          })
        )
      )
    ).toBe(
      "The `whatsapp.parameter_format` does not match the components' variables."
    )
  })

  test("messaging templates keep text and replies, and a channel cannot change", () => {
    expect(
      parseTemplateInput(
        body({
          channel: "messenger",
          name: "Hello",
          text: "Hi {{{name}}}",
          quick_replies: [{ title: "Yes", payload: "YES" }],
        }),
        true
      )
    ).toEqual({
      channel: "messenger",
      name: "Hello",
      text: "Hi {{{name}}}",
      content: {
        text: "Hi {{{name}}}",
        quick_replies: [{ title: "Yes", payload: "YES" }],
      },
    })
    expect(
      parseTemplateInput(body({ name: "Hello" }), false, "instagram").channel
    ).toBe("instagram")
    expect(
      rejection(() =>
        parseTemplateInput(body({ channel: "email", name: "Hello" }), false, "messenger")
      )
    ).toBe("A template's `channel` cannot change.")
    expect(
      rejection(() => parseTemplateInput(body({ channel: "sms" })))
    ).toMatch(/The `channel` field must be one of/)
    expect(
      rejection(() =>
        parseTemplateInput(body({ channel: "instagram", html: "<p>Hi</p>" }))
      )
    ).toBe("Messaging templates have no email or WhatsApp fields.")
    expect(
      rejection(() =>
        parseTemplateInput(body({ channel: "email", whatsapp: { language: "en" } }))
      )
    ).toBe("Only WhatsApp templates have a `whatsapp` field.")
  })
})

describe("dashboard field checks and publish", () => {
  test("dashboard names the channel that owns each field", () => {
    expect(
      rejection(() => assertTemplateFields("email", { whatsapp: {} }))
    ).toBe("Only WhatsApp templates have WhatsApp settings")
    expect(
      rejection(() => assertTemplateFields("whatsapp", { subject: "Hi" }))
    ).toBe("WhatsApp templates have no email fields")
    expect(
      rejection(() => assertTemplateFields("messenger", { from: "Ada" }))
    ).toBe("Messaging templates have no email fields")
    expect(() =>
      assertTemplateFields("whatsapp", { preview: "Hi" }, true)
    ).not.toThrow()
  })

  test("publishing requires channel content, and WhatsApp goes to Meta", () => {
    expect(() => templateChannels.email.publishCheck(null)).toThrow(
      "Add content to this template before publishing"
    )
    expect(() =>
      templateChannels.email.publishCheck({ html: "  " })
    ).toThrow("Add content to this template before publishing")
    expect(() =>
      templateChannels.email.publishCheck({ html: "<p>Hi</p>" })
    ).not.toThrow()
    expect(() =>
      templateChannels.whatsapp.publishCheck({
        html: "<p>Hi</p>",
        text: "Hi",
      })
    ).toThrow(SUBMIT_TO_META)

    const page = (channel: TemplateChannel, text: string) =>
      templateChannels[channel].publishCheck({
        html: "",
        text,
        content: { text },
      })
    expect(() => page("messenger", "  ")).toThrow(
      "Add content to this template before publishing"
    )
    expect(() => page("messenger", "x".repeat(1001))).not.toThrow()
    expect(() => page("instagram", "x".repeat(1001))).toThrow(/at most 1000/)
    expect(() => page("instagram", "Hi")).not.toThrow()
  })

  test("a messaging edit merges onto the saved draft", () => {
    expect(
      templateChannels.messenger.normalizeContent(
        { text: "New" },
        { text: "Old", quick_replies: [{ title: "A", payload: "a" }] }
      )
    ).toMatchObject({
      text: "New",
      content: {
        text: "New",
        quick_replies: [{ title: "A", payload: "a" }],
      },
    })
    expect(
      templateChannels.messenger.normalizeContent({ alias: "kept" })
    ).toEqual({ alias: "kept" })
    expect(
      templateChannels.whatsapp.normalizeContent({
        content: [{ type: "BODY", text: "Hi" }, { text: "drop me" }],
      }).content
    ).toEqual([{ type: "BODY", text: "Hi" }])
    expect(templateChannels.email.normalizeContent({ html: "<p>Hi</p>" })).toEqual(
      { html: "<p>Hi</p>" }
    )
  })
})
