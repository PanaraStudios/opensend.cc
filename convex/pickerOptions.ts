import { v, type Infer } from "convex/values"
import { OPTION_LIMIT, PICKER_SELECTED_LIMIT } from "../lib/dashboard/options"
import type { Doc } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { invalid } from "./api/caller"
import { teamRow } from "./lists"
import { voiceProvider } from "./tables/voice"

/** Tables a dashboard picker searches by name, plus the saved rows. */
export const pickerTables = [
  "voiceBots",
  "voiceProviders",
  "ivrs",
  "knowledgeBases",
  "botTools",
] as const
export type PickerTable = (typeof pickerTables)[number]
type VoiceProviderName = Infer<typeof voiceProvider>

export const pickerArgs = {
  organizationId: v.string(),
  search: v.optional(v.string()),
  selectedIds: v.optional(v.array(v.string())),
}

/** Newest names, or a search page, plus saved ids that fall outside it.
    Search uses the table's name index. Saved ids are point reads. */
export async function pickerRows<T extends PickerTable>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  search: string | undefined,
  selectedIds: readonly string[] | undefined,
  provider?: VoiceProviderName
): Promise<Doc<T>[]> {
  if ((selectedIds?.length ?? 0) > PICKER_SELECTED_LIMIT)
    throw invalid(`Look up at most ${PICKER_SELECTED_LIMIT} saved items`)
  if (provider && table !== "voiceProviders")
    throw invalid("Provider filter applies to provider keys")
  const needle = search?.trim()
  const page = needle
    ? await matching(ctx, table, organizationId, needle, provider)
    : await newest(ctx, table, organizationId, provider)
  const seen = new Set(page.map((row) => row._id as string))
  const extra: Doc<PickerTable>[] = []
  for (const id of new Set(selectedIds ?? [])) {
    const row = await teamRow(ctx, table, organizationId, id)
    if (!row || seen.has(row._id)) continue
    if (
      provider &&
      table === "voiceProviders" &&
      (row as unknown as Doc<"voiceProviders">).provider !== provider
    )
      continue
    extra.push(row as unknown as Doc<PickerTable>)
    seen.add(row._id)
  }
  return [...page, ...extra] as unknown as Doc<T>[]
}

async function newest(
  ctx: QueryCtx,
  table: PickerTable,
  organizationId: string,
  provider?: VoiceProviderName
): Promise<Doc<PickerTable>[]> {
  if (table === "voiceProviders" && provider)
    return await ctx.db
      .query("voiceProviders")
      .withIndex("by_organizationId_and_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", provider)
      )
      .order("desc")
      .take(OPTION_LIMIT)
  switch (table) {
    case "voiceBots":
      return await ctx.db
        .query("voiceBots")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
        .take(OPTION_LIMIT)
    case "voiceProviders":
      return await ctx.db
        .query("voiceProviders")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
        .take(OPTION_LIMIT)
    case "ivrs":
      return await ctx.db
        .query("ivrs")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
        .take(OPTION_LIMIT)
    case "knowledgeBases":
      return await ctx.db
        .query("knowledgeBases")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
        .take(OPTION_LIMIT)
    case "botTools":
      return await ctx.db
        .query("botTools")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
        .take(OPTION_LIMIT)
  }
}

async function matching(
  ctx: QueryCtx,
  table: PickerTable,
  organizationId: string,
  needle: string,
  provider?: VoiceProviderName
): Promise<Doc<PickerTable>[]> {
  switch (table) {
    case "voiceBots":
      return await ctx.db
        .query("voiceBots")
        .withSearchIndex("search_name", (q) =>
          q.search("name", needle).eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
    case "voiceProviders":
      return provider
        ? await ctx.db
            .query("voiceProviders")
            .withSearchIndex("search_label", (q) =>
              q
                .search("label", needle)
                .eq("organizationId", organizationId)
                .eq("provider", provider)
            )
            .take(OPTION_LIMIT)
        : await ctx.db
            .query("voiceProviders")
            .withSearchIndex("search_label", (q) =>
              q.search("label", needle).eq("organizationId", organizationId)
            )
            .take(OPTION_LIMIT)
    case "ivrs":
      return await ctx.db
        .query("ivrs")
        .withSearchIndex("search_name", (q) =>
          q.search("name", needle).eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
    case "knowledgeBases":
      return await ctx.db
        .query("knowledgeBases")
        .withSearchIndex("search_name", (q) =>
          q.search("name", needle).eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
    case "botTools":
      return await ctx.db
        .query("botTools")
        .withSearchIndex("search_name", (q) =>
          q.search("name", needle).eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
  }
}
