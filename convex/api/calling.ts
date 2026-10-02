import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import {
  apiRoute,
  objectBody,
  stringField,
  objectField,
  listParams,
  enumField,
} from "./route"
import { invalid } from "./caller"
import { channelSendInput } from "./channelMessages"

export function registerCallingRoutes(http: HttpRouter) {
  const read = { resource: "whatsapp", access: "read" } as const,
    write = { resource: "whatsapp", access: "write" } as const
  apiRoute(http, {
    method: "GET",
    path: "/whatsapp/calls",
    scope: read,
    handler: async (ctx, { caller, query }) => {
      const from = query.get("phone_number_id") ?? undefined
      const target = from
        ? await ctx.runQuery(internal.calling.rows.target, {
            organizationId: caller.organizationId,
            caller,
            from,
          })
        : null
      return {
        body: await ctx.runQuery(internal.calling.rows.list, {
          organizationId: caller.organizationId,
          caller,
          ...listParams(query),
          accountId: target?.account._id,
        }),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/whatsapp/calls/{id}",
    scope: read,
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runQuery(internal.calling.rows.get, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
      }),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/whatsapp/calls",
    scope: write,
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      for (const key of ["from", "to", "recipient"]) stringField(input, key)
      if (!input.to && !input.recipient)
        throw invalid("Supply to or recipient (BSUID).")
      return {
        body: await ctx.runAction(internal.calling.callActions.connect, {
          organizationId: caller.organizationId,
          caller,
          input,
        }),
      }
    },
  })
  for (const action of ["pre_accept", "accept", "reject", "terminate"] as const)
    apiRoute(http, {
      method: "POST",
      path: `/whatsapp/calls/{id}/${action}`,
      scope: write,
      handler: async (ctx, { caller, params, body }) => ({
        body: await ctx.runAction(internal.calling.callActions.perform, {
          organizationId: caller.organizationId,
          caller,
          id: params.id,
          action,
          input: objectBody(body),
        }),
      }),
    })
  for (const method of ["GET", "POST", "PATCH"] as const)
    apiRoute(http, {
      method,
      path: "/whatsapp/phone-numbers/{id}/calling",
      scope: method === "GET" ? read : write,
      handler: async (ctx, { caller, params, body }) => {
        const input = objectBody(body)
        return {
          body: await ctx.runAction(internal.calling.settings.getOrUpdate, {
            organizationId: caller.organizationId,
            caller,
            from: params.id,
            ...(method !== "GET"
              ? {
                  calling: objectField(input, "calling"),
                  routing: objectField(input, "routing") as
                    | typeof import("../tables/calling").callingRouting.type
                    | undefined,
                  mode: enumField(input, "handling_mode", [
                    "gateway",
                    "api",
                  ] as const),
                  announcementFileId: stringField(
                    input,
                    "announcement_file_id"
                  ),
                }
              : {}),
          }),
        }
      },
    })
  apiRoute(http, {
    method: "GET",
    path: "/whatsapp/call-permissions",
    scope: read,
    handler: async (ctx, { caller, query }) => {
      const identity = query.get("recipient") ?? query.get("to")
      if (!identity) throw invalid("Supply to or recipient (BSUID).")
      return {
        body: await ctx.runAction(internal.calling.settings.permissions, {
          organizationId: caller.organizationId,
          caller,
          from: query.get("from") ?? undefined,
          identity,
          bsuid: query.has("recipient"),
        }),
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/whatsapp/call-permissions",
    scope: write,
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body),
        template = objectField(input, "template"),
        text = stringField(input, "text")
      if (Number(template !== undefined) + Number(text !== undefined) !== 1)
        throw invalid(
          "Supply text for a free-form request, or a call-permission template."
        )
      const request = template
        ? { ...input, template }
        : {
            from: stringField(input, "from"),
            to: stringField(input, "to"),
            recipient: stringField(input, "recipient"),
            interactive: {
              type: "call_permission_request",
              action: { name: "call_permission_request" },
              body: { text },
            },
          }
      const id = await ctx.runMutation(internal.api.channelMessages.send, {
        caller,
        input: channelSendInput(request, "whatsapp"),
      })
      return { body: { id } }
    },
  })
}
