import { v } from "convex/values"

const fallback = { fallback: v.optional(v.string()) }
export const variableSource = v.union(
  v.string(),
  v.object({
    contact: v.union(
      v.literal("firstName"),
      v.literal("lastName"),
      v.literal("email"),
      v.literal("phone")
    ),
    ...fallback,
  }),
  v.object({ property: v.string(), ...fallback }),
  v.object({ value: v.string(), ...fallback })
)
export const variableSources = v.record(v.string(), variableSource)
