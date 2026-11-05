import { expect, test } from "vitest"
import type { Doc } from "./_generated/dataModel"
import { changedFields } from "./patchIfChanged"

const doc = {
  _id: "id",
  _creationTime: 1,
  organizationId: "team",
  channel: "whatsapp",
  search: "a b",
  lastPreview: "hi",
  properties: { city: "Pune", tags: ["x", "y"] },
} as unknown as Doc<"conversations">

test("values already stored are not patched", () => {
  expect(
    changedFields(doc, { organizationId: "team", lastPreview: "hi" })
  ).toEqual({})
  expect(
    changedFields(doc, {
      properties: { city: "Pune", tags: ["x", "y"] },
    } as never)
  ).toEqual({})
})

test("only the fields that differ are kept", () => {
  expect(
    changedFields(doc, { organizationId: "team", lastPreview: "new" })
  ).toEqual({ lastPreview: "new" })
  expect(
    changedFields(doc, { properties: { city: "Pune", tags: ["x"] } } as never)
  ).toEqual({ properties: { city: "Pune", tags: ["x"] } })
  expect(changedFields(doc, { properties: { city: "Pune" } } as never)).toEqual(
    { properties: { city: "Pune" } }
  )
})

test("undefined removes a field, so it differs only when the field is stored", () => {
  expect(changedFields(doc, { lastPreview: undefined })).toEqual({
    lastPreview: undefined,
  })
  expect(changedFields(doc, { unreadCount: undefined })).toEqual({})
})
