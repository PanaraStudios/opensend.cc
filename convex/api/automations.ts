import { teamRow } from "../lists"
import { flattenSteps } from "../../lib/dashboard/automation"
import { readGraph } from "../automationDefinition"
import { aliasOwner } from "../templates"
import { own as ownAudience } from "./audience"
import { v } from "convex/values"
import { stream } from "convex-helpers/server/stream"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import {
  createAutomation,
  updateAutomation,
  setAutomationStatus,
  duplicateAutomation,
  removeAutomation,
} from "../automations"
import { automationStatus, runStatus } from "../tables/automations"
import { patchRow } from "../counts"
import {
  callerValue,
  notFound,
  requireCaller,
  invalid,
  requireTeamRow,
} from "./caller"
import {
  listBody,
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
  queryValues,
} from "./route"
import { listArgs, cursorPage } from "./paging"
import { idempotent } from "./idempotency"
import { automationGraph, parseAutomationGraph } from "./automationGraph"

function own(ctx: QueryCtx, organizationId: string, value: string) {
  return requireTeamRow(
    ctx,
    "automations",
    organizationId,
    value,
    "Automation",
    { keep: (row) => !row.deleted }
  )
}
const reply = (id: string, kind: string) => ({
  object: "automation",
  id,
  ...(kind === "remove" ? { deleted: true } : {}),
  ...(kind === "stop" ? { status: "disabled" } : {}),
})
export const write = internalMutation({
  args: {
    caller: callerValue,
    id: v.optional(v.string()),
    kind: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("duplicate"),
      v.literal("remove"),
      v.literal("stop")
    ),
    body: v.string(),
  },
  returns: v.id("automations"),
  handler: async (ctx, { caller, id, kind, body }) => {
    await requireCaller(ctx, caller)
    return idempotent(
      ctx,
      caller,
      async () => {
        const row =
          kind === "create" ? null : await own(ctx, caller.organizationId, id!)
        if (kind === "duplicate")
          return duplicateAutomation(ctx, caller.organizationId, row!._id)
        if (kind === "remove") {
          await removeAutomation(ctx, caller.organizationId, row!._id)
          return row!._id
        }
        if (kind === "stop") {
          await setAutomationStatus(
            ctx,
            caller.organizationId,
            row!._id,
            "disabled"
          )
          return row!._id
        }
        const input = objectBody(JSON.parse(body))
        const name = stringField(input, "name", kind === "create")
        if (name !== undefined && (!name.trim() || name.length > 256))
          throw invalid(
            "Automation name must contain between 1 and 256 characters."
          )
        const status = enumField(input, "status", ["enabled", "disabled"])
        const hasGraph =
          input.steps !== undefined || input.connections !== undefined
        if (kind === "create" || hasGraph) {
          if (input.steps === undefined || input.connections === undefined)
            throw invalid("Both steps and connections are required.")
        } else if (name === undefined && status === undefined)
          throw invalid("Provide name, status, or steps and connections.")
        const graph =
          kind === "create" || hasGraph
            ? parseAutomationGraph(input.steps, input.connections)
            : undefined
        if (graph)
          for (const step of flattenSteps(readGraph(graph.graph))) {
            if (step.type === "add_to_segment")
              await ownAudience(
                ctx,
                "segments",
                caller.organizationId,
                step.segmentId
              )
            if (step.type === "send_email") {
              const tid = ctx.db.normalizeId("templates", step.templateId)
              const template = tid
                ? await ctx.db.get("templates", tid)
                : await aliasOwner(ctx, caller.organizationId, step.templateId)
              if (
                !template ||
                template.organizationId !== caller.organizationId
              )
                throw notFound("Template")
            }
          }
        const target =
          row?._id ?? (await createAutomation(ctx, caller.organizationId))
        await updateAutomation(ctx, caller.organizationId, target, {
          ...(name === undefined ? {} : { name }),
          ...(graph
            ? {
                trigger: graph.trigger,
                triggerFilters: graph.triggerFilters,
                graph: graph.graph,
              }
            : {}),
        })
        if (graph)
          await patchRow(ctx, "automations", target, {
            apiDefinition: graph.apiDefinition,
          })
        if (status) {
          const tasks = await setAutomationStatus(
            ctx,
            caller.organizationId,
            target,
            status
          )
          if (tasks.length)
            throw invalid(tasks.flatMap((task) => task.tasks).join("; "))
        }
        return target
      },
      (id) => ({
        status: kind === "create" || kind === "duplicate" ? 201 : 200,
        body: reply(id, kind),
      })
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: schema.doc("automations"),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return own(ctx, caller.organizationId, id)
  },
})
export const list = internalQuery({
  args: {
    caller: callerValue,
    ...listArgs,
    status: v.optional(automationStatus),
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("automations")),
  }),
  handler: async (ctx, { caller, status, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage(
      page,
      async (value) => {
        const row = await teamRow(
          ctx,
          "automations",
          caller.organizationId,
          value
        )
        return row && !row.deleted && (!status || row.status === status)
          ? row
          : null
      },
      (order) => {
        const rows = stream(ctx.db, schema).query("automations")
        return (
          status
            ? rows.withIndex("by_organizationId_and_deleted_and_status", (q) =>
                q
                  .eq("organizationId", caller.organizationId)
                  .eq("deleted", false)
                  .eq("status", status)
              )
            : rows.withIndex("by_organizationId_and_deleted", (q) =>
                q
                  .eq("organizationId", caller.organizationId)
                  .eq("deleted", false)
              )
        ).order(order)
      }
    )
  },
})
const runArgs = { caller: callerValue, id: v.string() }
export const runs = internalQuery({
  args: { ...runArgs, ...listArgs, status: v.optional(v.array(runStatus)) },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("automationRuns")),
  }),
  handler: async (ctx, { caller, id, status, ...page }) => {
    await requireCaller(ctx, caller)
    const automation = await own(ctx, caller.organizationId, id)
    // Several status indexes merge in memory: each is read from the anchor's
    // time inclusive, and cursorPage breaks equal-time ties by id.
    let anchor: Doc<"automationRuns"> | undefined
    const count = page.limit + 1
    return cursorPage(
      page,
      async (value) => {
        const row = await teamRow(
          ctx,
          "automationRuns",
          caller.organizationId,
          value
        )
        anchor =
          row &&
          row.automationId === automation._id &&
          (!status || status.includes(row.status))
            ? row
            : undefined
        return anchor ?? null
      },
      async (order) => {
        const bound =
          anchor === undefined
            ? {}
            : order === "desc"
              ? { lt: anchor._creationTime }
              : { gt: anchor._creationTime }
        if (!status?.length)
          return ctx.db
            .query("automationRuns")
            .withIndex("by_organizationId_and_automationId", (q) => {
              const base = q
                .eq("organizationId", caller.organizationId)
                .eq("automationId", automation._id)
              return bound.lt !== undefined
                ? base.lte("_creationTime", bound.lt)
                : bound.gt !== undefined
                  ? base.gte("_creationTime", bound.gt)
                  : base
            })
            .order(order)
            .take(count + 1)
        const pages = await Promise.all(
          status.map((value) =>
            ctx.db
              .query("automationRuns")
              .withIndex(
                "by_organizationId_and_automationId_and_status",
                (q) => {
                  const base = q
                    .eq("organizationId", caller.organizationId)
                    .eq("automationId", automation._id)
                    .eq("status", value)
                  return bound.lt !== undefined
                    ? base.lte("_creationTime", bound.lt)
                    : bound.gt !== undefined
                      ? base.gte("_creationTime", bound.gt)
                      : base
                }
              )
              .order(order)
              .take(count + 1)
          )
        )
        return pages
          .flat()
          .sort(
            (a, b) =>
              (order === "asc" ? 1 : -1) *
              (a._creationTime - b._creationTime || a._id.localeCompare(b._id))
          )
          .slice(0, count + 1)
      }
    )
  },
})
export const run = internalQuery({
  args: { ...runArgs, runId: v.string() },
  returns: v.object({
    row: schema.doc("automationRuns"),
    steps: v.array(schema.doc("automationRunSteps")),
  }),
  handler: async (ctx, { caller, id, runId }) => {
    await requireCaller(ctx, caller)
    const automation = await own(ctx, caller.organizationId, id)
    const row = await teamRow(
      ctx,
      "automationRuns",
      caller.organizationId,
      runId
    )
    if (!row || row.automationId !== automation._id)
      throw notFound("Automation run")
    const steps = await ctx.db
      .query("automationRunSteps")
      .withIndex("by_organizationId_and_runId_and_key", (q) =>
        q.eq("organizationId", caller.organizationId).eq("runId", row._id)
      )
      .take(101)
    return { row, steps }
  },
})
const summary = (row: Doc<"automations">) => ({
  id: row._id,
  name: row.name,
  status: row.status,
  created_at: apiTime(row._creationTime),
  updated_at: apiTime(row.updatedAt),
})
const runSummary = (row: Doc<"automationRuns">) => ({
  id: row._id,
  status: row.status,
  started_at: apiTime(row._creationTime),
  completed_at: row.completedAt === undefined ? null : apiTime(row.completedAt),
  created_at: apiTime(row._creationTime),
})
function runStatuses(query: URLSearchParams) {
  const values = queryValues(query, "status", true)
  return values.length
    ? values.map((status) =>
        enumField({ status }, "status", [
          "running",
          "completed",
          "failed",
          "cancelled",
        ] as const)!
      )
    : undefined
}
export function registerAutomationRoutes(http: HttpRouter) {
  for (const kind of [
    "create",
    "update",
    "remove",
    "duplicate",
    "stop",
  ] as const)
    apiRoute(http, {
      method:
        kind === "update" ? "PATCH" : kind === "remove" ? "DELETE" : "POST",
      path:
        kind === "create"
          ? "/automations"
          : `/automations/{automation_id}${kind === "duplicate" || kind === "stop" ? `/${kind}` : ""}`,
      scope: { resource: "automations", access: "write" },
      handler: async (ctx, { caller, params, body }) => ({
        status: kind === "create" || kind === "duplicate" ? 201 : 200,
        body: reply(
          await ctx.runMutation(internal.api.automations.write, {
            caller,
            id: params.automation_id,
            kind,
            body: JSON.stringify(body ?? {}),
          }),
          kind
        ),
      }),
    })
  apiRoute(http, {
    method: "GET",
    path: "/automations",
    scope: { resource: "automations", access: "read" },
    handler: async (ctx, { caller, query }) => {
      const result = await ctx.runQuery(internal.api.automations.list, {
        caller,
        ...listParams(query),
        status: enumField(
          Object.fromEntries([["status", query.get("status")]]),
          "status",
          ["enabled", "disabled"]
        ),
      })
      return {
        body: listBody(result, summary),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/automations/{automation_id}",
    scope: { resource: "automations", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const row = await ctx.runQuery(internal.api.automations.get, {
        caller,
        id: params.automation_id,
      })
      return {
        body: {
          object: "automation",
          ...summary(row),
          ...automationGraph(row),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/automations/{automation_id}/runs",
    scope: { resource: "automations", access: "read" },
    handler: async (ctx, { caller, params, query }) => {
      const result = await ctx.runQuery(internal.api.automations.runs, {
        caller,
        id: params.automation_id,
        ...listParams(query),
        status: runStatuses(query),
      })
      return {
        body: listBody(result, runSummary),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/automations/{automation_id}/runs/{run_id}",
    scope: { resource: "automations", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const { row, steps } = await ctx.runQuery(internal.api.automations.run, {
        caller,
        id: params.automation_id,
        runId: params.run_id,
      })
      const definition = automationGraph(row)
      const keys = [
        definition.steps.find((s) => s.type === "trigger")!.key,
        ...flattenSteps(readGraph(row.graph)).map((s) => s.key),
      ]
      const triggerKey = definition.steps.find((s) => s.type === "trigger")!.key
      const mapped = steps
        .map((s) => ({
          key: s.type === "trigger" ? triggerKey : s.key,
          type: s.type,
          status: s.status,
          started_at: apiTime(s.startedAt),
          completed_at:
            s.completedAt === undefined ? null : apiTime(s.completedAt),
          inputs: s.inputs ?? null,
          output: s.output ?? null,
          error: s.error ? { message: s.error } : null,
          created_at: apiTime(s._creationTime),
        }))
        .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))
      return {
        body: { object: "automation_run", ...runSummary(row), steps: mapped },
      }
    },
  })
}
