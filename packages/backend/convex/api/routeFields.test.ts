import { ConvexError } from "convex/values"
import { describe, expect, test } from "vitest"
import {
  arrayField,
  booleanField,
  enumField,
  listParams,
  objectBody,
  objectField,
  stringField,
  stringListField,
} from "./route"

function message(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError)
    return (error as ConvexError<{ message: string }>).data.message
  }
  throw new Error("expected a validation error")
}

describe("list parameters", () => {
  test("defaults the page size and keeps one cursor", () => {
    expect(listParams(new URLSearchParams())).toEqual({
      limit: 20,
      after: undefined,
      before: undefined,
    })
    expect(listParams(new URLSearchParams("limit=1&after=next"))).toEqual({
      limit: 1,
      after: "next",
      before: undefined,
    })
    expect(listParams(new URLSearchParams("limit=100&before=prev"))).toEqual({
      limit: 100,
      after: undefined,
      before: "prev",
    })
  })

  test("rejects a page size outside 1 to 100 and two cursors together", () => {
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=many", "limit="])
      expect(message(() => listParams(new URLSearchParams(query)))).toBe(
        "The `limit` parameter must be an integer between 1 and 100."
      )
    expect(
      message(() => listParams(new URLSearchParams("after=next&before=prev")))
    ).toBe("The `after` and `before` parameters cannot be used together.")
  })
})

describe("body fields", () => {
  test("objects, strings, booleans and enums keep absent values empty", () => {
    expect(objectBody(undefined)).toEqual({})
    expect(message(() => objectBody(null))).toBe(
      "The request body must be a JSON object."
    )
    expect(message(() => objectBody(["a"]))).toBe(
      "The request body must be a JSON object."
    )
    expect(stringField({ name: "Ada" }, "name", true)).toBe("Ada")
    expect(stringField({}, "name")).toBeUndefined()
    expect(message(() => stringField({}, "name", true))).toBe(
      "Missing `name` field."
    )
    expect(message(() => stringField({ name: 1 }, "name"))).toBe(
      "The `name` field must be a string."
    )
    expect(booleanField({ on: true }, "on")).toBe(true)
    expect(booleanField({ on: null }, "on")).toBeUndefined()
    expect(message(() => booleanField({ on: "true" }, "on"))).toBe(
      "The `on` field must be a boolean."
    )
    expect(enumField({ channel: "email" }, "channel", ["email", "whatsapp"])).toBe(
      "email"
    )
    expect(
      message(() => enumField({ channel: "sms" }, "channel", ["email"]))
    ).toBe("The `channel` field must be one of: email.")
    expect(objectField({ whatsapp: { language: "en" } }, "whatsapp")).toEqual({
      language: "en",
    })
    expect(objectField({}, "whatsapp")).toBeUndefined()
    expect(message(() => objectField({ whatsapp: [] }, "whatsapp"))).toBe(
      "The `whatsapp` field must be an object."
    )
    expect(arrayField({}, "tags")).toEqual([])
    expect(arrayField({ tags: null }, "tags")).toEqual([])
    expect(message(() => arrayField({ tags: "a" }, "tags"))).toBe(
      "The `tags` field must be an array."
    )
  })

  test("string lists accept one address or many, and can refuse null", () => {
    expect(stringListField({ reply_to: "a@example.test" }, "reply_to")).toEqual([
      "a@example.test",
    ])
    expect(
      stringListField({ reply_to: ["a@example.test", "b@example.test"] }, "reply_to")
    ).toEqual(["a@example.test", "b@example.test"])
    expect(stringListField({}, "reply_to")).toBeUndefined()
    expect(stringListField({ reply_to: null }, "reply_to")).toBeUndefined()
    expect(
      stringListField({ reply_to: "" }, "reply_to", { emptyString: true })
    ).toEqual([])
    expect(stringListField({ reply_to: "" }, "reply_to")).toEqual([""])
    expect(
      message(() =>
        stringListField({ reply_to: null }, "reply_to", {
          rejectNull: true,
          message: "Invalid `reply_to` field.",
        })
      )
    ).toBe("Invalid `reply_to` field.")
    expect(
      message(() =>
        stringListField({ reply_to: "a@example.test" }, "reply_to", {
          arrayOnly: true,
        })
      )
    ).toBe("The `reply_to` field must be an array of strings.")
    expect(
      message(() => stringListField({ reply_to: ["ok", 1] }, "reply_to"))
    ).toBe("The `reply_to` field must be a string or an array of strings.")
  })
})
