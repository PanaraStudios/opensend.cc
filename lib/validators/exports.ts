/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { v } from "convex/values"

export const exportStatusValue = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("expired"),
  v.literal("failed")
)
