import { describe, expect, it } from "vitest"
import {
  validateWhatsAppSchema,
  whatsappBodySchemas,
  type WhatsAppSchema,
} from "./schema"

const check = (schema: WhatsAppSchema, value: unknown, path = "field") =>
  validateWhatsAppSchema(schema, value, path)

describe("validateWhatsAppSchema", () => {
  it("rejects blank strings and counts Unicode code points", () => {
    const text: WhatsAppSchema = { type: "string", minLength: 1, maxLength: 1 }
    expect(() => check(text, "  ")).toThrow("field: must be nonempty")
    expect(() => check(text, 1)).toThrow("field: must be a string")
    expect(() => check(text, "👍👍")).toThrow("field: must be at most 1 characters")
    expect(() => check(text, "👍")).not.toThrow()
    // A set minLength means nonempty. It does not count characters.
    expect(() =>
      check({ type: "string", minLength: 5 }, "ab")
    ).not.toThrow()
  })

  it("bounds numbers and integers, including the endpoints", () => {
    const score: WhatsAppSchema = {
      type: "number",
      minimum: -90,
      maximum: 90,
    }
    expect(() => check(score, -90)).not.toThrow()
    expect(() => check(score, 90.5)).toThrow("field: must be at most 90")
    expect(() => check(score, Number.NaN)).toThrow("field: must be a finite number")
    const count: WhatsAppSchema = { type: "integer", minimum: 0 }
    expect(() => check(count, 0)).not.toThrow()
    expect(() => check(count, 1.5)).toThrow("field: must be a finite integer")
    expect(() => check(count, -1)).toThrow("field: must be at least 0")
    expect(() => check({ type: "boolean" }, "true")).toThrow(
      "field: must be a boolean"
    )
  })

  it("checks enums, patterns, arrays and nested object fields", () => {
    expect(() => check({ enum: ["a", "b"] }, "c")).toThrow(
      "field: must be one of a, b"
    )
    expect(() =>
      check({ type: "string", pattern: "^https?://" }, "ftp://files")
    ).toThrow("field: invalid format")
    const items: WhatsAppSchema = {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "string", minLength: 1 },
    }
    expect(() => check(items, [])).toThrow("field: must contain at least 1 items")
    expect(() => check(items, ["a", "b", "c"])).toThrow(
      "field: must contain at most 2 items"
    )
    expect(() => check(items, "a")).toThrow("field: must be an array")
    expect(() => check(items, ["ok", "  "])).toThrow("field[1]: must be nonempty")
    const record: WhatsAppSchema = {
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
      additionalProperties: false,
    }
    expect(() => check(record, ["name"])).toThrow("field: must be an object")
    expect(() => check(record, {})).toThrow("field: missing name")
    expect(() => check(record, { name: "Ada", extra: 1 })).toThrow(
      "field: unsupported field extra"
    )
    const open: WhatsAppSchema = {
      type: "object",
      additionalProperties: { type: "number" },
    }
    expect(() => check(open, { score: "high" }, "row")).toThrow(
      "row.score: must be a finite number"
    )
    expect(() => check(open, { score: 1 })).not.toThrow()
  })

  it("requires exactly one oneOf branch and lets anyOf accept several", () => {
    const text = {
      type: "object",
      properties: {
        type: { enum: ["text"] },
        text: { type: "string", minLength: 1 },
      },
      required: ["type", "text"],
    } satisfies WhatsAppSchema
    const image = {
      type: "object",
      properties: {
        type: { enum: ["image"] },
        image: { type: "string", minLength: 1 },
      },
      required: ["type", "image"],
    } satisfies WhatsAppSchema
    const exclusive: WhatsAppSchema = { oneOf: [text, image] }
    expect(() => check(exclusive, { type: "text", text: "Hi" })).not.toThrow()
    expect(() => check(exclusive, { type: "text" })).toThrow(/missing text/)
    expect(() => check(exclusive, { type: "text" })).not.toThrow(/image/)
    expect(() => check(exclusive, { type: "other" })).toThrow(/missing text/)
    const overlapping: WhatsAppSchema = {
      oneOf: [{ type: "string", minLength: 1 }, { type: "string" }],
    }
    expect(() => check(overlapping, "Hi")).toThrow(
      "field: provide exactly one alternative"
    )
    const either: WhatsAppSchema = {
      anyOf: [{ type: "string", minLength: 1 }, { type: "string" }],
    }
    expect(() => check(either, "Hi")).not.toThrow()
  })
})

describe("WhatsApp body schemas", () => {
  it("accepts one media locator and a location inside its range", () => {
    expect(() =>
      check(whatsappBodySchemas.image, { id: "media" }, "image")
    ).not.toThrow()
    expect(() =>
      check(
        whatsappBodySchemas.image,
        { link: "https://cdn.example.test/a.jpg" },
        "image"
      )
    ).not.toThrow()
    expect(() =>
      check(
        whatsappBodySchemas.image,
        { id: "media", link: "https://cdn.example.test/a.jpg" },
        "image"
      )
    ).toThrow("image: provide exactly one alternative")
    expect(() => check(whatsappBodySchemas.image, {}, "image")).toThrow(
      /missing id/
    )
    expect(() =>
      check(
        whatsappBodySchemas.location,
        { latitude: 90, longitude: -180 },
        "location"
      )
    ).not.toThrow()
    expect(() =>
      check(whatsappBodySchemas.location, { latitude: 91, longitude: 0 }, "location")
    ).toThrow("location.latitude: must be at most 90")
  })

  it("stops a contact list at 257 entries", () => {
    const contact = { name: { formatted_name: "Ada" } }
    expect(() =>
      check(whatsappBodySchemas.contacts, Array.from({ length: 257 }, () => contact))
    ).not.toThrow()
    expect(() =>
      check(
        whatsappBodySchemas.contacts,
        Array.from({ length: 258 }, () => contact),
        "contacts"
      )
    ).toThrow("contacts: must contain at most 257 items")
  })
})
