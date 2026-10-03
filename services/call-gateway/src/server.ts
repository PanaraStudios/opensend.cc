import { createServer, type IncomingMessage } from "node:http"
import { normalizePrompt } from "./prompt-audio.js"
import { HmacVerifier } from "./auth.js"
import type { GatewayApi, RouteRequest } from "./contracts.js"
import { AgentSessions, directoryAuthorized } from "./agents.js"
import type { AgentControl } from "./contracts.js"
import { GatewayError } from "./errors.js"

async function bodyOf(
  request: IncomingMessage,
  limit = 128 * 1024
): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > limit)
      throw new GatewayError(
        "BODY_TOO_LARGE",
        "Request exceeds size limit",
        413
      )
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

export function createGatewayServer(
  api: GatewayApi,
  secret: string,
  agents?: {
    sessions: AgentSessions
    directorySecret: string
    sipSecret: string
    control: (request: AgentControl) => Promise<void>
  }
) {
  const verifier = new HmacVerifier(secret)
  const operations = new Map<string, Promise<unknown>>()
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json")
    response.setHeader("cache-control", "no-store")
    try {
      const path = request.url ?? "/"
      if (request.method === "POST" && path === "/agents/directory" && agents) {
        if (
          !directoryAuthorized(
            request.headers.authorization,
            agents.directorySecret
          )
        )
          throw new GatewayError(
            "DIRECTORY_UNAUTHORIZED",
            "Unauthorized directory request",
            401
          )
        const form = new URLSearchParams(await bodyOf(request))
        if (
          form.get("section") !== "directory" ||
          (form.get("domain") ?? form.get("key_value")) !== "freeswitch"
        )
          throw new GatewayError(
            "INVALID_DIRECTORY",
            "Invalid directory lookup"
          )
        response.setHeader("content-type", "text/xml")
        response.end(
          agents.sessions.directory(
            form.get("user") ?? form.get("sip_auth_username") ?? "",
            agents.sipSecret
          )
        )
        return
      }
      if (request.method === "GET" && path === "/healthz") {
        const ok = await api.healthy()
        response.writeHead(ok ? 200 : 503).end(JSON.stringify({ ok }))
        return
      }
      if (
        request.method !== "POST" ||
        ![
          "/prompts/normalize",
          "/inbound",
          "/outbound",
          "/playground",
          "/remoteAnswer",
          "/hangup",
          "/route",
          "/agents/session",
          "/agents/revoke",
          "/control",
        ].includes(path)
      )
        throw new GatewayError("NOT_FOUND", "Unknown endpoint", 404)
      if (request.headers["content-type"]?.split(";")[0] !== "application/json")
        throw new GatewayError("CONTENT_TYPE", "Use application/json", 415)
      const raw = await bodyOf(
        request,
        path === "/prompts/normalize" ? 23 * 1024 * 1024 : 128 * 1024
      )
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
      if (path === "/prompts/normalize") {
        const audio = textField(body, "audio")
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio))
          throw new GatewayError("INVALID_AUDIO", "Invalid base64 audio")
        const wav = await normalizePrompt(Buffer.from(audio, "base64"))
        response.setHeader("content-type", "audio/wav")
        response.end(wav)
        return
      }
      if (path === "/agents/session" || path === "/agents/revoke") {
        if (!agents?.directorySecret)
          throw new GatewayError(
            "AGENTS_UNAVAILABLE",
            "Dynamic agent directory is not configured",
            503
          )
        const sessionId = textField(body, "sessionId")
        if (!/^[a-zA-Z0-9._:-]{1,256}$/.test(sessionId))
          throw new GatewayError("INVALID_SESSION", "Invalid session")
        if (path === "/agents/revoke") {
          agents.sessions.revoke(sessionId)
          response.end(JSON.stringify({ ok: true }))
        } else response.end(JSON.stringify(agents.sessions.issue(sessionId)))
        return
      }
      const callId = textField(body, "callId")
      // Safe in SIP headers and ESL variable lists. Convex ids and wacids fit this alphabet.
      if (!/^[a-zA-Z0-9._:-]{1,256}$/.test(callId))
        throw new GatewayError("INVALID_CALL_ID", "Invalid callId")
      const run = async () => {
        switch (path) {
          case "/control":
            if (!agents)
              throw new GatewayError(
                "AGENTS_UNAVAILABLE",
                "Browser controls unavailable",
                503
              )
            if (
              body.extension !== undefined &&
              (typeof body.extension !== "string" ||
                !agents.sessions.active(body.extension))
            )
              throw new GatewayError(
                "AGENT_OFFLINE",
                "Agent session expired",
                409
              )
            if (body.queue !== undefined && typeof body.queue !== "string")
              throw new GatewayError("INVALID_QUEUE", "Invalid queue")
            if (
              body.organizationId !== undefined &&
              typeof body.organizationId !== "string"
            )
              throw new GatewayError("INVALID_TEAM", "Invalid team")
            await agents.control({
              callId,
              organizationId: body.organizationId as string | undefined,
              operation: textField(
                body,
                "operation"
              ) as AgentControl["operation"],
              extension: body.extension as string | undefined,
              queue: body.queue as string | undefined,
            })
            return { ok: true }
          case "/inbound":
            return api.inbound(textField(body, "offerSdp"), callId)
          case "/playground": {
            const extension = textField(body, "extension")
            if (
              !/^20\d{2}$/.test(extension) ||
              !agents?.sessions.active(extension)
            )
              throw new GatewayError(
                "AGENT_OFFLINE",
                "Register a browser session first",
                409
              )
            if (!api.playground)
              throw new GatewayError(
                "PLAYGROUND_UNAVAILABLE",
                "Playground calls unavailable",
                503
              )
            await api.playground({ callId, extension })
            return { ok: true }
          }
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
            if (
              body.target === "agent" &&
              agents &&
              !agents.sessions.active(String(body.extension))
            )
              throw new GatewayError(
                "AGENT_OFFLINE",
                "Agent session expired",
                409
              )
            for (const field of [
              "organizationId",
              "adapter",
              "codec",
              "ivrId",
              "botId",
            ])
              if (body[field] !== undefined && typeof body[field] !== "string")
                throw new GatewayError(
                  "INVALID_REQUEST",
                  `${field} must be a string`
                )
            if (
              body.maxDurationSeconds !== undefined &&
              typeof body.maxDurationSeconds !== "number"
            )
              throw new GatewayError(
                "INVALID_DURATION",
                "Duration must be a number"
              )
            if (
              body.answeredAt !== undefined &&
              typeof body.answeredAt !== "number"
            )
              throw new GatewayError(
                "INVALID_REQUEST",
                "answeredAt must be a number"
              )
            await api.route({
              callId,
              target: textField(body, "target") as RouteRequest["target"],
              ...(body.ivrId !== undefined
                ? { ivrId: body.ivrId as string }
                : {}),
              ...(body.silenceTimeoutSeconds !== undefined
                ? {
                    silenceTimeoutSeconds: body.silenceTimeoutSeconds as number,
                  }
                : {}),
              ...(body.botId !== undefined
                ? { botId: body.botId as string }
                : {}),
              ...(body.organizationId !== undefined
                ? { organizationId: body.organizationId as string }
                : {}),
              ...(body.adapter !== undefined
                ? { adapter: body.adapter as RouteRequest["adapter"] }
                : {}),
              ...(body.codec !== undefined
                ? { codec: body.codec as RouteRequest["codec"] }
                : {}),
              ...(body.maxDurationSeconds !== undefined
                ? { maxDurationSeconds: body.maxDurationSeconds as number }
                : {}),
              ...(body.extension !== undefined
                ? { extension: body.extension as string }
                : {}),
              ...(body.record !== undefined
                ? { record: body.record as boolean }
                : {}),
              ...(body.answeredAt !== undefined
                ? { answeredAt: body.answeredAt as number }
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
