import { randomUUID } from "node:crypto"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { createMcpExpressApp } from "@modelcontextprotocol/express"
import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
  toWebRequest,
} from "@modelcontextprotocol/node"
import {
  createMcpHandler,
  isInitializeRequest,
  isLegacyRequest,
} from "@modelcontextprotocol/server"
import { Opensend } from "@opensend/sdk"
import { USER_AGENT } from "../user-agent.js"
import { createMcpServer } from "../server.js"
import type { ServerOptions } from "../types.js"

function sendJsonRpcError(
  res: ServerResponse,
  statusCode: number,
  message: string
): void {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    })
  )
}

/**
 * Extract the Opensend API key from the Authorization: Bearer header.
 * Returns null if the header is missing or malformed.
 */
function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith("Bearer ")) return null
  const token = header.slice("Bearer ".length).trim()
  return token || null
}

function extractBearerTokenFromWebRequest(req: Request): string | null {
  const header = req.headers.get("authorization")
  if (!header || !header.startsWith("Bearer ")) return null
  const token = header.slice("Bearer ".length).trim()
  return token || null
}

export interface HttpTransportOptions {
  baseUrl?: string
  /**
   * Host used to derive the SDK's DNS-rebinding protection. Defaults to
   * `'127.0.0.1'`, which keeps localhost-only `Host` header validation enabled
   * — the safe default for servers run locally.
   *
   * Set to `'0.0.0.0'` when deploying behind a reverse proxy / load balancer
   * where the server is already protected by per-request auth (the Bearer API
   * key). This disables `Host` validation so the proxy's forwarded `Host` and
   * load-balancer health-check requests (which use the task's private IP) are
   * accepted instead of rejected with `403 Invalid Host`.
   */
  host?: string
  /**
   * Explicit allow-list of acceptable `Host` header hostnames. When provided,
   * only these are accepted (overrides the `host`-based default). Use this to
   * pin specific public hostnames instead of disabling validation entirely.
   * Note: a load balancer health check sends the task IP as `Host`, so an
   * allow-list must also include that if the LB health-checks this server.
   */
  allowedHosts?: string[]
}

/**
 * Start the HTTP transport. Each session gets its own Opensend client created
 * from the Bearer token provided by the connecting client. This allows
 * remote deployment where each user authenticates with their own API key
 * instead of a single server-side key.
 */
export async function runHttp(
  options: ServerOptions,
  port: number,
  httpOptions: HttpTransportOptions = {}
): Promise<Server> {
  const sessions: Record<string, NodeStreamableHTTPServerTransport> = {}
  const sessionKeys: Record<string, string> = {}
  const { host = "127.0.0.1", allowedHosts } = httpOptions
  const baseUrl = httpOptions.baseUrl ?? process.env.OPENSEND_BASE_URL
  if (!baseUrl?.trim())
    throw new Error("No base URL. Set OPENSEND_BASE_URL or provide baseUrl.")

  const app = createMcpExpressApp({ host, allowedHosts })

  app.get("/health", (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok" }))
  })

  // Checked in handleMcp before dispatching here — a factory throw becomes a 500, not this 401.
  const modernHandler = createMcpHandler(
    (ctx) => {
      const apiKey = ctx.requestInfo
        ? extractBearerTokenFromWebRequest(ctx.requestInfo)
        : null
      if (!apiKey) {
        throw new Error(
          "Unauthorized: provide an Opensend API key via Authorization: Bearer <key>"
        )
      }
      return createMcpServer(
        new Opensend(apiKey, { baseUrl, userAgent: USER_AGENT }),
        options
      )
    },
    { legacy: "reject" }
  )
  const modernNodeHandler = toNodeHandler(modernHandler)

  // Serve the Streamable HTTP transport at both `/mcp` and the root `/` so
  // clients and proxies that target the server's root URL work identically.
  const handleMcp = async (
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse
  ) => {
    const webRequest = await toWebRequest(req, req.body)
    if (!(await isLegacyRequest(webRequest, req.body))) {
      const apiKey = extractBearerTokenFromWebRequest(webRequest)
      if (!apiKey) {
        sendJsonRpcError(
          res,
          401,
          "Unauthorized: provide an Opensend API key via Authorization: Bearer <key>"
        )
        return
      }
      await modernNodeHandler(req, res, req.body)
      return
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined
    let transport: NodeStreamableHTTPServerTransport | undefined

    if (sessionId && sessions[sessionId]) {
      if (extractBearerToken(req) !== sessionKeys[sessionId]) {
        sendJsonRpcError(
          res,
          401,
          "Unauthorized: provide the API key that initialized this session."
        )
        return
      }
      transport = sessions[sessionId]
    } else if (
      !sessionId &&
      req.method === "POST" &&
      isInitializeRequest(req.body)
    ) {
      // New session: require a Bearer token so we can create a per-session
      // Opensend client scoped to this user's API key.
      const apiKey = extractBearerToken(req)
      if (!apiKey) {
        sendJsonRpcError(
          res,
          401,
          "Unauthorized: provide an Opensend API key via Authorization: Bearer <key>"
        )
        return
      }

      const opensend = new Opensend(apiKey, { baseUrl, userAgent: USER_AGENT })

      transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions[sid] = transport!
          sessionKeys[sid] = apiKey
        },
      })
      transport.onclose = () => {
        const sid = transport!.sessionId
        if (sid) {
          delete sessions[sid]
          delete sessionKeys[sid]
        }
      }
      const server = createMcpServer(opensend, options)
      await server.connect(transport)
    } else if (sessionId && !sessions[sessionId]) {
      res.statusCode = 404
      res.setHeader("Content-Type", "application/json")
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        })
      )
      return
    } else {
      sendJsonRpcError(res, 400, "Bad Request: No valid session ID provided")
      return
    }

    await transport.handleRequest(req, res, req.body)
  }

  app.all("/mcp", handleMcp)
  app.all("/", handleMcp)

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.error(`Opensend MCP server listening on http://127.0.0.1:${port}`)
      console.error("  Streamable HTTP: POST/GET/DELETE / and /mcp")
      resolve(server)
    })
    server.once("error", reject)

    const shutdown = async () => {
      for (const sid of Object.keys(sessions)) {
        try {
          await sessions[sid].close()
        } catch {
          // ignore
        }
        delete sessions[sid]
      }
      await modernHandler.close().catch(() => {})
      server.close()
      process.exit(0)
    }
    server.once("close", () => {
      process.off("SIGINT", shutdown)
      process.off("SIGTERM", shutdown)
      for (const sid of Object.keys(sessions)) {
        void sessions[sid].close().catch(() => {})
        delete sessions[sid]
        delete sessionKeys[sid]
      }
      void modernHandler.close().catch(() => {})
    })
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  })
}
