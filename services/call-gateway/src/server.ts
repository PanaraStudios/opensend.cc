import { createServer, type IncomingMessage } from "node:http"
import { HmacVerifier } from "./auth.js"
import type { GatewayApi, RouteRequest } from "./contracts.js"
import { GatewayError } from "./errors.js"

async function bodyOf(request: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 128 * 1024)
      throw new GatewayError("BODY_TOO_LARGE", "Request exceeds 128 KiB", 413)
    chunks.push(buffer)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks)
    )
  } catch {
    throw new GatewayError("INVALID_ENCODING", "Request body must be UTF-8")
  }
}
const textField = (body: Record<string, unknown>, key: string): string => {
  if (typeof body[key] !== "string" || !body[key])
    throw new GatewayError(
      "INVALID_REQUEST",
      `${key} must be a nonempty string`
    )
  return body[key]
}

export function createGatewayServer(api: GatewayApi, secret: string) {
  const verifier = new HmacVerifier(secret)
  const operations = new Map<string, Promise<unknown>>()
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json")
    response.setHeader("cache-control", "no-store")
    try {
      const path = request.url ?? "/"
      if (request.method === "GET" && path === "/healthz") {
        const ok = await api.healthy()
        response.writeHead(ok ? 200 : 503).end(JSON.stringify({ ok }))
        return
      }
      if (
        request.method !== "POST" ||
        ![
          "/inbound",
          "/outbound",
          "/remoteAnswer",
          "/hangup",
          "/route",
        ].includes(path)
      )
        throw new GatewayError("NOT_FOUND", "Unknown endpoint", 404)
      if (request.headers["content-type"]?.split(";")[0] !== "application/json")
        throw new GatewayError("CONTENT_TYPE", "Use application/json", 415)
      const raw = await bodyOf(request)
      verifier.verify("POST", path, raw, request.headers)
      let body: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error()
        body = parsed as Record<string, unknown>
      } catch {
        throw new GatewayError("INVALID_JSON", "Expected a JSON object")
      }
      const callId = textField(body, "callId")
      // Safe in SIP headers and ESL variable lists. Convex ids and wacids fit this alphabet.
      if (!/^[a-zA-Z0-9._:-]{1,256}$/.test(callId))
        throw new GatewayError("INVALID_CALL_ID", "Invalid callId")
      const run = async () => {
        switch (path) {
          case "/inbound":
            return api.inbound(textField(body, "offerSdp"), callId)
          case "/outbound":
            return api.outbound(callId)
          case "/remoteAnswer":
            await api.remoteAnswer(callId, textField(body, "sdp"))
            return { ok: true }
          case "/hangup":
            await api.hangup(callId)
            return { ok: true }
          case "/route":
            if (
              body.extension !== undefined &&
              typeof body.extension !== "string"
            )
              throw new GatewayError(
                "INVALID_EXTENSION",
                "extension must be a string"
              )
            if (body.record !== undefined && typeof body.record !== "boolean")
              throw new GatewayError("INVALID_RECORD", "record must be boolean")
            await api.route({
              callId,
              target: textField(body, "target") as RouteRequest["target"],
              ...(body.extension !== undefined
                ? { extension: body.extension as string }
                : {}),
              ...(body.record !== undefined
                ? { record: body.record as boolean }
                : {}),
            })
            return { ok: true }
        }
      }
      // Serialize per-call state changes; hangup remains able to interrupt a slow setup.
      const operation =
        path === "/hangup"
          ? run()
          : (operations.get(callId) ?? Promise.resolve())
              .catch(() => undefined)
              .then(run)
      if (path !== "/hangup") operations.set(callId, operation)
      try {
        response.end(JSON.stringify(await operation))
      } finally {
        if (operations.get(callId) === operation) operations.delete(callId)
      }
    } catch (error) {
      const known = error instanceof GatewayError
      if (!known)
        console.error(
          "Gateway request failed:",
          error instanceof Error ? error.message : "Unknown error"
        )
      response.writeHead(known ? error.status : 500).end(
        JSON.stringify({
          error: {
            code: known ? error.code : "INTERNAL_ERROR",
            message: known ? error.message : "Gateway request failed",
          },
        })
      )
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  return server
}
