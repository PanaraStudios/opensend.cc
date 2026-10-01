import { test } from "node:test"
import assert from "node:assert/strict"
import {
  normalizeVariableSource,
  CONTACT_VARIABLE_FIELDS,
  resolveVariables,
  variableSourcesError,
} from "./variables"

test("campaign mappings resolve contact fields, properties, static text and fallbacks", () => {
  assert.deepEqual(
    resolveVariables(
      {
        a: { contact: "firstName" },
        b: { contact: "email", fallback: "no email" },
        c: { property: "company" },
        d: { value: "Hello" },
        e: "literal",
        f: { property: "missing", fallback: "there" },
        g: { contact: "phone" },
        h: { property: "default" },
      },
      {
        firstName: "Alex",
        phone: "+15551234567",
        properties: { company: "Acme" },
      },
      { default: "default value" }
    ),
    {
      a: "Alex",
      b: "no email",
      c: "Acme",
      d: "Hello",
      e: "literal",
      f: "there",
      g: "+15551234567",
      h: "default value",
    }
  )
})
test("mapping validation rejects unknown fields, multiple sources and malformed fallback", () => {
  for (const value of [
    null,
    [],
    { a: 42 },
    { a: { contact: "id" } },
    { a: { property: "a.b" } },
    { a: { contact: "phone", value: "x" } },
    { a: { value: "x", fallback: 5 } },
    { a: { value: "x", extra: "ignored" } },
  ])
    assert.ok(variableSourcesError(value))
  assert.equal(
    variableSourcesError({ a: "text", b: { contact: "phone", fallback: "" } }),
    null
  )
})

test("legacy strings normalize without losing the static source", () => {
  assert.deepEqual(normalizeVariableSource("hello"), { value: "hello" })
  const source = { contact: "phone" as const, fallback: "unknown" }
  assert.equal(normalizeVariableSource(source), source)
  assert.deepEqual(
    CONTACT_VARIABLE_FIELDS.map((field) => field.value),
    ["firstName", "lastName", "email", "phone"]
  )
})
