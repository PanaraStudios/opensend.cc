"use node"
import { env, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { decryptSecret } from "../secrets"
import { publicFetch } from "../../lib/net/public-fetch"
import { localHttpOrigin } from "../../lib/net/public-host"
import { ConvexError } from "convex/values"
import { MetaError, parseGraphResponse } from "../../lib/meta/errors"
import { graphUrl, type GraphQuery } from "../../lib/meta/graph-url"

/** The fake Graph server development and e2e point META_GRAPH_ORIGIN at.
    Only a local HTTP origin is honored, so production always calls Meta. */
export const graphLocalOrigin = () =>
  env.META_GRAPH_ORIGIN ? localHttpOrigin(env.META_GRAPH_ORIGIN) : undefined

/** The app access token, `appId|appSecret`, for app-level Graph calls. */
export const appAccessToken = async (app: {
  appId: string
  encryptedAppSecret: string
}) => `${app.appId}|${await decryptSecret(app.encryptedAppSecret)}`

/** One Graph API call through the pinned public fetch. Returns the parsed
    JSON or throws a MetaError (lib/meta/errors.ts). */
export async function graph<T = unknown>(input: {
  /** A user, system-user, Page or app access token (`appId|appSecret`). */
  token: string
  method: "GET" | "POST" | "DELETE"
  path: string
  version: string
  query?: GraphQuery
  /** JSON, form fields, or raw bytes with their content type. */
  body?:
    | { json: unknown }
    | { form: Record<string, string> }
    | { bytes: Uint8Array; contentType: string }
  /** Replaces default headers, like the upload API's `OAuth` scheme. */
  headers?: Record<string, string>
  localOrigin?: string
}): Promise<T> {
  const localOrigin = input.localOrigin ?? graphLocalOrigin()
  const url = graphUrl({
    version: input.version,
    path: input.path,
    query: input.query,
    origin: localOrigin,
  })
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.token}`,
    accept: "application/json",
  }
  let body: string | Uint8Array | undefined
  if (input.body && "json" in input.body) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(input.body.json)
  } else if (input.body && "form" in input.body) {
    headers["content-type"] = "application/x-www-form-urlencoded"
    body = new URLSearchParams(input.body.form).toString()
  } else if (input.body) {
    headers["content-type"] = input.body.contentType
    body = input.body.bytes
  }
  Object.assign(headers, input.headers)
  const response = await publicFetch(url, {
    method: input.method,
    headers,
    body,
    timeoutMs: 20_000,
    maxBytes: 5 * 1024 * 1024,
    localOrigin,
  })
  return parseGraphResponse(response.status, await response.text()) as T
}

/** What the dashboard shows for a failed Graph action: a ConvexError's own
    message, Meta's reason, or a network failure. */
export function graphFailure(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : error instanceof MetaError
      ? `Meta refused the request: ${error.message}`
      : "Could not reach Meta. Try again."
}

export const TOKEN_REFUSED =
  "Meta refused the business token. Reconnect the business."

/** Runs Graph calls for the dashboard: failures become messages it can
    show, and a refused token (190) flags the connection for reconnecting. */
export async function friendly<T>(
  ctx: ActionCtx,
  run: () => Promise<T>,
  connectionId?: Id<"metaConnections">
): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof MetaError && e.action === "token_invalid") {
      if (!connectionId)
        throw new ConvexError("Meta refused the token. Check it and try again.")
      await ctx.runMutation(internal.meta.connect.markConnection, {
        connectionId,
        status: "error",
        error: TOKEN_REFUSED,
      })
      throw new ConvexError(TOKEN_REFUSED)
    }
    throw new ConvexError(graphFailure(e))
  }
}
