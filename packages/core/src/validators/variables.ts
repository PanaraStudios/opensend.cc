/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { CONTACT_VARIABLE_FIELDS } from "../meta/variables"
import { v } from "convex/values"

const fallback = { fallback: v.optional(v.string()) }
export const variableSource = v.union(
  v.string(),
  v.object({
    contact: v.union(
      ...CONTACT_VARIABLE_FIELDS.map((field) => v.literal(field.value))
    ),
    ...fallback,
  }),
  v.object({ property: v.string(), ...fallback }),
  v.object({ value: v.string(), ...fallback })
)
export const variableSources = v.record(v.string(), variableSource)
