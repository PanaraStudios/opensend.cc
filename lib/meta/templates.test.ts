import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  EMPTY_TEMPLATE_FORM,
  TemplateVariablesMissing,
  TemplateHeaderMediaMissing,
  componentsFromForm,
  componentsParameterFormat,
  formFromComponents,
  isTemplateName,
  readMetaTemplates,
  readTemplateUpdate,
  templateNameFrom,
  templateProblems,
  templateSendComponents,
  templateVariables,
  renderTemplate,
  renderedTemplateFromForm,
  type TemplateComponent,
  type TemplateForm,
} from "./templates"

const positional: TemplateForm = {
  ...EMPTY_TEMPLATE_FORM,
  headerFormat: "TEXT",
  headerText: "Act fast, {{1}}!",
  body: "Your code {{1}} expires in {{2}} days.",
  footer: "Lucky Shrub",
  buttons: [
    { type: "URL", text: "See deals", url: "https://shrub.example/d/{{1}}" },
    { type: "QUICK_REPLY", text: "Unsubscribe" },
  ],
  examples: {
    header_1: "Pablo",
    "1": "SUMMER20",
    "2": "10",
    button_0: "summer",
  },
}

const named: TemplateForm = {
  ...EMPTY_TEMPLATE_FORM,
  body: "Thank you, {{first_name}}! Your order is {{order_number}}.",
  buttons: [{ type: "COPY_CODE" }],
  examples: {
    first_name: "Pablo",
    order_number: "860198",
    coupon_code: "250FF",
  },
}

const definition = (
  components: TemplateComponent[],
  overrides: Partial<Parameters<typeof templateProblems>[0]> = {}
) => ({
  name: "order_confirmation",
  language: "en_US",
  category: "UTILITY",
  parameterFormat: componentsParameterFormat(components),
  components,
  ...overrides,
})

describe("template names", () => {
  it("allows lowercase letters, digits and underscores", () => {
    assert.equal(isTemplateName("order_confirmation_2"), true)
    assert.equal(isTemplateName("Order confirmation"), false)
    assert.equal(isTemplateName(""), false)
    assert.equal(isTemplateName("a".repeat(513)), false)
  })
  it("makes a valid name from any text", () => {
    assert.equal(templateNameFrom("Spring Sale 2026!"), "spring_sale_2026")
    assert.equal(templateNameFrom("  "), "untitled_template")
  })
})

describe("componentsFromForm", () => {
  it("writes positional examples as Meta's creation format", () => {
    assert.deepEqual(componentsFromForm(positional), [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Act fast, {{1}}!",
        example: { header_text: ["Pablo"] },
      },
      {
        type: "BODY",
        text: "Your code {{1}} expires in {{2}} days.",
        example: { body_text: [["SUMMER20", "10"]] },
      },
      { type: "FOOTER", text: "Lucky Shrub" },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "See deals",
            url: "https://shrub.example/d/{{1}}",
            example: ["https://shrub.example/d/summer"],
          },
          { type: "QUICK_REPLY", text: "Unsubscribe" },
        ],
      },
    ])
  })
  it("writes named examples with their parameter names", () => {
    assert.deepEqual(componentsFromForm(named), [
      {
        type: "BODY",
        text: "Thank you, {{first_name}}! Your order is {{order_number}}.",
        example: {
          body_text_named_params: [
            { param_name: "first_name", example: "Pablo" },
            { param_name: "order_number", example: "860198" },
          ],
        },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "COPY_CODE", example: "250FF" }],
      },
    ])
  })
  it("reads back the same form", () => {
    for (const form of [positional, named]) {
      const { form: back, supported } = formFromComponents(
        componentsFromForm(form)
      )
      assert.equal(supported, true)
      assert.deepEqual(back, form)
    }
  })
  it("marks parts the editor cannot show as unsupported", () => {
    const { supported } = formFromComponents([
      { type: "BODY", text: "Hi" },
      { type: "CAROUSEL", cards: [] },
    ])
    assert.equal(supported, false)
  })
})

describe("templateProblems", () => {
  it("accepts a complete template", () => {
    assert.deepEqual(
      templateProblems(definition(componentsFromForm(positional))),
      []
    )
    assert.deepEqual(
      templateProblems(definition(componentsFromForm(named))),
      []
    )
  })
  it("requires an example for every variable", () => {
    const components = componentsFromForm({
      ...positional,
      examples: { ...positional.examples, "2": "" },
    })
    assert.deepEqual(templateProblems(definition(components)), [
      "Add an example for {{2}} in the body",
    ])
  })
  it("checks the name, language and category", () => {
    const problems = templateProblems(
      definition(componentsFromForm(named), {
        name: "Bad Name",
        language: "english",
        category: "PROMO",
      })
    )
    assert.deepEqual(problems.slice(0, 3), [
      "Use only lowercase letters, numbers and underscores in the name",
      "Choose a supported language",
      "Choose a category",
    ])
  })
  it("enforces Meta's lengths and button rules", () => {
    const problems = templateProblems(
      definition(
        componentsFromForm({
          ...EMPTY_TEMPLATE_FORM,
          body: "x".repeat(1025),
          footer: "y".repeat(61),
          buttons: [
            { type: "QUICK_REPLY", text: "One" },
            { type: "URL", text: "Site", url: "https://a.example" },
            { type: "QUICK_REPLY", text: "Two" },
            { type: "PHONE_NUMBER", text: "Call", phone: "+15550100" },
            { type: "PHONE_NUMBER", text: "Call again", phone: "+15550101" },
          ],
        })
      )
    )
    assert.ok(problems.includes("Keep the body to 1024 characters"))
    assert.ok(problems.includes("Keep the footer to 60 characters"))
    assert.ok(problems.includes("Group the quick reply buttons together"))
    assert.ok(
      problems.includes(
        "A template can have at most 1 call phone number button"
      )
    )
  })
  it("keeps positional variables in order and apart", () => {
    const problems = templateProblems(
      definition(
        componentsFromForm({
          ...EMPTY_TEMPLATE_FORM,
          body: "Hi {{2}}{{1}} there",
          examples: { "1": "a", "2": "b" },
        })
      )
    )
    assert.ok(
      problems.includes(
        "Number the body's variables in order, starting at {{1}}"
      )
    )
    assert.ok(problems.includes("Put text between the body's variables"))
  })
  it("refuses a format that does not match the text", () => {
    const components = componentsFromForm(named)
    assert.ok(
      templateProblems(
        definition(components, { parameterFormat: "positional" })
      ).includes("Positional templates use variables like {{1}}")
    )
  })
})

describe("templateSendComponents", () => {
  it("maps positional variables to header, body and button parameters", () => {
    const components = componentsFromForm(positional)
    assert.deepEqual(
      templateVariables(components, "positional").map(({ key }) => key),
      ["header_1", "1", "2", "button_0"]
    )
    assert.deepEqual(
      templateSendComponents(components, "positional", {
        header_1: "Jessica",
        "1": "WINTER",
        "2": 3,
        button_0: "winter",
      }),
      [
        { type: "header", parameters: [{ type: "text", text: "Jessica" }] },
        {
          type: "body",
          parameters: [
            { type: "text", text: "WINTER" },
            { type: "text", text: "3" },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: "winter" }],
        },
      ]
    )
  })
  it("names named parameters and fills a copy-code button", () => {
    assert.deepEqual(
      templateSendComponents(componentsFromForm(named), "named", {
        first_name: "Jessica",
        order_number: "SKBUP2",
        coupon_code: "25OFF",
      }),
      [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "first_name", text: "Jessica" },
            { type: "text", parameter_name: "order_number", text: "SKBUP2" },
          ],
        },
        {
          type: "button",
          sub_type: "copy_code",
          index: "0",
          parameters: [{ type: "coupon_code", coupon_code: "25OFF" }],
        },
      ]
    )
  })
  it("links a media header supplied for this send", () => {
    const components = componentsFromForm({
      ...EMPTY_TEMPLATE_FORM,
      headerFormat: "IMAGE",
      headerSample: "https://cdn.example/sale.png",
      body: "Our sale is on.",
    })
    assert.deepEqual(
      templateSendComponents(components, "positional", {
        header_media: "https://cdn.example/sale.png",
      }),
      [
        {
          type: "header",
          parameters: [
            { type: "image", image: { link: "https://cdn.example/sale.png" } },
          ],
        },
      ]
    )
  })
  for (const format of ["IMAGE", "VIDEO", "DOCUMENT"] as const) {
    const media = format.toLowerCase()
    const components = componentsFromForm({
      ...EMPTY_TEMPLATE_FORM,
      headerFormat: format,
      headerSample: "4::meta-review-handle",
      body: "An update",
    })
    it(`builds a ${format} header from a provided file`, () => {
      assert.deepEqual(
        templateSendComponents(components, "positional", {
          header_media: "opensend-file:provided",
        }),
        [
          {
            type: "header",
            parameters: [{ type: media, [media]: { id: "provided" } }],
          },
        ]
      )
    })
    it(`falls back to a stored ${format} sample`, () => {
      const local = componentsFromForm({
        ...EMPTY_TEMPLATE_FORM,
        headerFormat: format,
        headerSample: "opensend-file:sample",
        body: "An update",
      })
      assert.deepEqual(templateSendComponents(local, "positional", {}), [
        {
          type: "header",
          parameters: [{ type: media, [media]: { id: "sample" } }],
        },
      ])
      assert.deepEqual(
        templateSendComponents(local, "positional", {
          header_media: "opensend-file:provided",
        }),
        [
          {
            type: "header",
            parameters: [{ type: media, [media]: { id: "provided" } }],
          },
        ]
      )
    })
    it(`requires a sendable ${format} header and never sends review handles`, () => {
      assert.throws(
        () => templateSendComponents(components, "positional", {}),
        (error) =>
          error instanceof TemplateHeaderMediaMissing &&
          error.message === `This template needs a header ${media}.`
      )
      assert.throws(
        () =>
          templateSendComponents(components, "positional", {
            header_media: "4::meta-review-handle",
          }),
        /Header media must be a file upload or a public HTTP URL/
      )
      assert.throws(
        () =>
          templateSendComponents(
            componentsFromForm({
              ...EMPTY_TEMPLATE_FORM,
              headerFormat: format,
              headerSample: "https://cdn.example/sample",
              body: "An update",
            }),
            "positional",
            {}
          ),
        TemplateHeaderMediaMissing
      )
    })
  }
  it("names every missing variable", () => {
    assert.throws(
      () =>
        templateSendComponents(componentsFromForm(positional), "positional", {
          "1": "x",
        }),
      (error: unknown) =>
        error instanceof TemplateVariablesMissing &&
        error.missing.join() === "header_1,2,button_0"
    )
  })
})

describe("reading Meta", () => {
  it("narrows a list response to what a sync stores", () => {
    assert.deepEqual(
      readMetaTemplates([
        {
          id: "1387372356726668",
          name: "reservation_confirmation",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          parameter_format: "NAMED",
          quality_score: { score: "GREEN" },
          rejected_reason: "NONE",
          components: [{ type: "BODY", text: "Hi {{name}}" }, "junk"],
        },
        { id: "2", name: "", language: "en" },
        {
          id: 3,
          name: "later",
          language: "en",
          category: "FREE_SERVICE",
          status: "SOMETHING_NEW",
          components: [],
        },
      ]),
      [
        {
          id: "1387372356726668",
          name: "reservation_confirmation",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          parameterFormat: "named",
          components: [{ type: "BODY", text: "Hi {{name}}" }],
          quality: "GREEN",
        },
        {
          id: "3",
          name: "later",
          language: "en",
          category: "UTILITY",
          status: "PENDING",
          parameterFormat: "positional",
          components: [],
        },
      ]
    )
  })
  it("reads status, category and quality webhooks", () => {
    assert.deepEqual(
      readTemplateUpdate("message_template_status_update", {
        event: "REJECTED",
        message_template_id: 1689556908129835,
        reason: "INVALID_FORMAT",
        message_template_category: "MARKETING",
        rejection_info: { reason: "Parameters touch." },
      }),
      {
        metaTemplateId: "1689556908129835",
        metaStatus: "REJECTED",
        rejectedReason: "Parameters touch.",
        category: "MARKETING",
      }
    )
    assert.deepEqual(
      readTemplateUpdate("message_template_status_update", {
        event: "REINSTATED",
        message_template_id: 1,
      }),
      { metaTemplateId: "1", metaStatus: "APPROVED", rejectedReason: null }
    )
    assert.deepEqual(
      readTemplateUpdate("message_template_status_update", {
        event: "UNARCHIVED",
        message_template_id: 1,
      }),
      { metaTemplateId: "1", resync: true }
    )
    assert.deepEqual(
      readTemplateUpdate("message_template_status_update", {
        event: "FLAGGED",
        message_template_id: 1,
      }),
      { metaTemplateId: "1" }
    )
    // An impending recategorization changes nothing yet.
    assert.deepEqual(
      readTemplateUpdate("template_category_update", {
        message_template_id: 2,
        new_category: "UTILITY",
        correct_category: "MARKETING",
      }),
      { metaTemplateId: "2" }
    )
    assert.deepEqual(
      readTemplateUpdate("template_category_update", {
        message_template_id: 2,
        previous_category: "UTILITY",
        new_category: "MARKETING",
      }),
      { metaTemplateId: "2", category: "MARKETING" }
    )
    assert.deepEqual(
      readTemplateUpdate("message_template_quality_update", {
        message_template_id: 3,
        new_quality_score: "RED",
      }),
      { metaTemplateId: "3", quality: "RED" }
    )
    assert.equal(
      readTemplateUpdate("messages", { message_template_id: 1 }),
      null
    )
    assert.equal(
      readTemplateUpdate("message_template_status_update", {
        event: "APPROVED",
      }),
      null
    )
  })
})

describe("renderTemplate", () => {
  it("fills positional body/header parameters separately and preserves footer/button labels", () => {
    assert.deepEqual(
      renderTemplate(
        componentsFromForm(positional),
        templateSendComponents(
          componentsFromForm(positional),
          "positional",
          positional.examples
        )
      ),
      {
        header: { format: "TEXT", text: "Act fast, Pablo!" },
        body: "Your code SUMMER20 expires in 10 days.",
        footer: "Lucky Shrub",
        buttons: [
          {
            type: "URL",
            text: "See deals",
            url: "https://shrub.example/d/summer",
          },
          { type: "QUICK_REPLY", text: "Unsubscribe" },
        ],
      }
    )
  })
  it("fills named parameters by name rather than their wire order", () => {
    assert.deepEqual(
      renderTemplate(componentsFromForm(named), [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "order_number", text: "42" },
            { type: "text", parameter_name: "first_name", text: "Ada" },
          ],
        },
      ]),
      {
        body: "Thank you, Ada! Your order is 42.",
        buttons: [{ type: "COPY_CODE", text: "Copy offer code" }],
      }
    )
  })
  it("fills a named header parameter", () => {
    assert.deepEqual(
      renderTemplate(
        [
          { type: "HEADER", format: "TEXT", text: "Hi {{name}}" },
          { type: "BODY", text: "Welcome" },
        ],
        [
          {
            type: "header",
            parameters: [
              { type: "text", parameter_name: "name", text: "Pablo" },
            ],
          },
        ]
      ),
      {
        header: { format: "TEXT", text: "Hi Pablo" },
        body: "Welcome",
        buttons: [],
      }
    )
  })
  for (const format of ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"] as const)
    it(`keeps a ${format} header's format`, () => {
      assert.deepEqual(
        renderTemplate([
          { type: "HEADER", format },
          { type: "BODY", text: "An update" },
        ]),
        { header: { format }, body: "An update", buttons: [] }
      )
    })
  it("leaves missing parameters visible, without using stored examples", () => {
    assert.equal(
      renderTemplate(componentsFromForm(positional)).body,
      positional.body
    )
    assert.equal(
      renderTemplate(
        [{ type: "BODY", text: "Hi {{1}}, order {{2}}" }],
        [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }]
      ).body,
      "Hi Ada, order {{2}}"
    )
  })
  it("uses documented currency/date-time fallback values", () => {
    assert.equal(
      renderTemplate(
        [{ type: "BODY", text: "{{1}} on {{2}}" }],
        [
          {
            type: "body",
            parameters: [
              { type: "currency", currency: { fallback_value: "$10" } },
              { type: "date_time", date_time: { fallback_value: "Monday" } },
            ],
          },
        ]
      ).body,
      "$10 on Monday"
    )
  })
  it("does not interpret parameters inside a replacement value", () => {
    assert.equal(
      renderTemplate(
        [{ type: "BODY", text: "Hi {{1}}, {{2}}" }],
        [
          {
            type: "body",
            parameters: [
              { type: "text", text: "{{2}}" },
              { type: "text", text: "ready" },
            ],
          },
        ]
      ).body,
      "Hi {{2}}, ready"
    )
  })
  it("adapts the editor's example values and leaves unfilled examples visible", () => {
    assert.deepEqual(
      renderedTemplateFromForm(positional),
      renderTemplate(
        componentsFromForm(positional),
        templateSendComponents(
          componentsFromForm(positional),
          "positional",
          positional.examples
        )
      )
    )
    assert.equal(
      renderedTemplateFromForm({ ...named, examples: {} }).body,
      named.body
    )
  })
})

it("snapshots carousel bodies and action parameters with each card's index", () => {
  const rendered = renderTemplate(
    [
      { type: "BODY", text: "Choose an item" },
      {
        type: "CAROUSEL",
        cards: [
          {
            components: [
              { type: "BODY", text: "First {{1}}" },
              {
                type: "BUTTONS",
                buttons: [
                  {
                    type: "URL",
                    text: "Visit",
                    url: "https://example.test/{{1}}",
                  },
                ],
              },
            ],
          },
          {
            components: [
              { type: "HEADER", format: "IMAGE" },
              { type: "BODY", text: "Second {{1}}" },
              {
                type: "BUTTONS",
                buttons: [{ type: "COPY_CODE", text: "Copy" }],
              },
            ],
          },
        ],
      },
    ],
    [
      {
        type: "carousel",
        cards: [
          {
            card_index: 1,
            components: [
              { type: "body", parameters: [{ type: "text", text: "B" }] },
              {
                type: "button",
                index: 0,
                parameters: [{ type: "coupon_code", coupon_code: "SAVE20" }],
              },
            ],
          },
          {
            card_index: 0,
            components: [
              { type: "body", parameters: [{ type: "text", text: "A" }] },
              {
                type: "button",
                index: 0,
                parameters: [{ type: "text", text: "offer" }],
              },
            ],
          },
        ],
      },
    ]
  )
  assert.equal(rendered.cards?.[0].body, "First A")
  assert.deepEqual(rendered.cards?.[0].buttons, [
    { type: "URL", text: "Visit", url: "https://example.test/offer" },
  ])
  assert.equal(rendered.cards?.[1].body, "Second B")
  assert.deepEqual(rendered.cards?.[1].buttons, [
    { type: "COPY_CODE", text: "Copy", code: "SAVE20" },
  ])
})
