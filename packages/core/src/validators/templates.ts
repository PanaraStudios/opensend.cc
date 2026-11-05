/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { v } from "convex/values"
import { literals } from "./channels"
import {
  PARAMETER_FORMATS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_QUALITIES,
  TEMPLATE_STATUSES,
} from "../meta/templates"

export const templateStatusValue = v.union(
  v.literal("draft"),
  v.literal("published")
)
export const templateCategoryValue = literals(TEMPLATE_CATEGORIES)
export const metaTemplateStatusValue = literals(TEMPLATE_STATUSES)
export const templateQualityValue = literals(TEMPLATE_QUALITIES)
export const parameterFormatValue = literals(PARAMETER_FORMATS)
/** A WhatsApp template's place at Meta. Its name is the row's `name`; its
    components are the draft's `content`. Unique per WABA, name and
    language, as Meta requires. */
export const whatsappTemplateValue = v.object({
  wabaId: v.string(),
  language: v.string(),
  category: templateCategoryValue,
  parameterFormat: parameterFormatValue,
  /** Set once Meta accepted the submission. */
  metaTemplateId: v.optional(v.string()),
  metaStatus: v.optional(metaTemplateStatusValue),
  rejectedReason: v.optional(v.string()),
  quality: v.optional(templateQualityValue),
  submittedAt: v.optional(v.number()),
  /** The last sync that changed this template. The WABA records every sync. */
  syncedAt: v.optional(v.number()),
  /** A fingerprint of the components the last sync wrote to the live copy,
      so a sync that finds them unchanged skips reading the draft and live
      copy. Cleared whenever anything else writes the live copy. */
  syncHash: v.optional(v.string()),
  /** Retained local sample, separate from Meta's review-only upload handle. */
  sampleFileId: v.optional(v.id("storedFiles")),
})
