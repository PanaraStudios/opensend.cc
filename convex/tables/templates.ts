import { defineTable } from "convex/server"
import { v } from "convex/values"
import { channelValue } from "./channels"
import {
  PARAMETER_FORMATS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_QUALITIES,
  TEMPLATE_STATUSES,
} from "../../lib/meta/templates"

export const templateStatusValue = v.union(
  v.literal("draft"),
  v.literal("published")
)
export const templateVariableValue = v.object({
  key: v.string(),
  type: v.optional(v.union(v.literal("string"), v.literal("number"))),
  fallback: v.optional(v.string()),
})

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)))
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
})

export const resolvedTemplateValue = v.object({
  templateId: v.id("templates"),
  name: v.string(),
  language: v.string(),
  wabaId: v.string(),
  category: templateCategoryValue,
  parameterFormat: parameterFormatValue,
  /** Keys a send's `variables` fills (lib/meta/templates.ts). */
  variables: v.array(v.string()),
  components: v.any(),
})

/* A template is three documents, so no read pays for more than it uses: the
   row the list, search and pickers read; the draft body only the editor and
   the list's thumbnails read; and the published copy only sends read. The
   published copy is its own document rather than a field so an autosave
   rewriting the draft can never touch what is live. */
export const templateTables = {
  templates: defineTable({
    organizationId: v.string(),
    /** Absent means email; email templates never store it. */
    channel: v.optional(channelValue),
    /** A WhatsApp template's name is Meta's: lowercase and underscores. */
    name: v.string(),
    /** Unique in the team; enforced by `by_organizationId_and_alias`. */
    alias: v.string(),
    status: templateStatusValue,
    subject: v.string(),
    preview: v.string(),
    from: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    replyToAddresses: v.optional(v.array(v.string())),
    /** The draft's variables, at most MAX_TEMPLATE_VARIABLES. */
    variables: v.array(v.string()),
    variableDefinitions: v.optional(v.array(templateVariableValue)),
    version: v.optional(v.number()),
    variableMetadata: v.optional(
      v.array(
        v.object({
          key: v.string(),
          id: v.string(),
          createdAt: v.number(),
          updatedAt: v.number(),
          type: v.string(),
          fallback: v.optional(v.string()),
        })
      )
    ),
    updatedAt: v.number(),
    /** As in the demo contract: moved forward by an edit that changes
        nothing sent, and kept through a revert to draft. */
    publishedAt: v.optional(v.number()),
    /** Name and alias, as words, for the list's search. */
    searchText: v.string(),
    whatsapp: v.optional(whatsappTemplateValue),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_status", ["organizationId", "status"])
    .index("by_organizationId_and_alias", ["organizationId", "alias"])
    .index("by_organizationId_and_channel", ["organizationId", "channel"])
    .index("by_organizationId_and_name_and_whatsapp_language", [
      "organizationId",
      "name",
      "whatsapp.language",
    ])
    .index("by_whatsapp_metaTemplateId", ["whatsapp.metaTemplateId"])
    .searchIndex("search_searchText", {
      searchField: "searchText",
      filterFields: ["organizationId", "status"],
    }),
  templateDrafts: defineTable({
    templateId: v.id("templates"),
    html: v.string(),
    text: v.optional(v.string()),
    /** The editor document; absent for hand-written HTML. */
    content: v.optional(v.any()),
  }).index("by_templateId", ["templateId"]),
  publishedTemplates: defineTable({
    templateId: v.id("templates"),
    organizationId: v.string(),
    subject: v.string(),
    preview: v.string(),
    html: v.string(),
    text: v.optional(v.string()),
    from: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    replyToAddresses: v.optional(v.array(v.string())),
    variables: v.array(templateVariableValue),
    /** A WhatsApp template's components as submitted to Meta. */
    components: v.optional(v.any()),
    publishedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_templateId", ["templateId"]),
}
