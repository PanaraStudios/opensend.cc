import { defineTable } from "convex/server"
import { v } from "convex/values"

export const templateStatusValue = v.union(
  v.literal("draft"),
  v.literal("published")
)
export const templateVariableValue = v.object({
  key: v.string(),
  type: v.optional(v.union(v.literal("string"), v.literal("number"))),
  fallback: v.optional(v.string()),
})

/* A template is three documents, so no read pays for more than it uses: the
   row the list, search and pickers read; the draft body only the editor and
   the list's thumbnails read; and the published copy only sends read. The
   published copy is its own document rather than a field so an autosave
   rewriting the draft can never touch what is live. */
export const templateTables = {
  templates: defineTable({
    organizationId: v.string(),
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
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_status", ["organizationId", "status"])
    .index("by_organizationId_and_alias", ["organizationId", "alias"])
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
    publishedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_templateId", ["templateId"]),
}
