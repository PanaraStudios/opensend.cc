import { once } from "node:events"
import type { AddressInfo } from "node:net"
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { afterEach, expect, it, vi } from "vitest"
import { runHttp } from "../src/transports/http.js"
import { fakeKey, baseUrl } from "./helpers/client.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it.each(["legacy", "modern"] as const)(
  "routes %s HTTP SDK calls to the configured installation",
  async (era) => {
    const originalFetch = globalThis.fetch
    const requests: Request[] = []
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init)
        if (new URL(req.url).origin !== baseUrl)
          return originalFetch(input, init)
        requests.push(req)
        return Response.json({ data: [], has_more: false, object: "list" })
      })
    )
    const server = await runHttp({}, 0, { baseUrl })
    const url = new URL(
      "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/mcp"
    )
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: "Bearer " + fakeKey } },
    })
    const client = new Client(
      { name: "http-sdk-test", version: "0.0.0" },
      era === "modern"
        ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
        : {}
    )
    try {
      await client.connect(transport)
      const result = await client.callTool({
        name: "list-domains",
        arguments: {},
      })
      expect(result.isError).toBeFalsy()
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(baseUrl + "/domains")
      expect(requests[0].headers.get("authorization")).toBe("Bearer " + fakeKey)
      expect(requests[0].headers.get("user-agent")).toBe("opensend-mcp:0.1.0")
      if (era === "legacy") {
        for (const authorization of [
          "",
          "Bearer os_test1111111111111111111111111111",
        ]) {
          const response = await originalFetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "mcp-session-id": transport.sessionId!,
              authorization,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 9,
              method: "tools/call",
              params: { name: "list-domains", arguments: {} },
            }),
          })
          expect(response.status).toBe(401)
        }
        expect(requests).toHaveLength(1)
      }
    } finally {
      await client.close()
      server.close()
      await once(server, "close")
    }
  }
)
