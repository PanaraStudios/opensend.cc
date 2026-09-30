import { serveStdio } from "@modelcontextprotocol/server/stdio"
import type { Opensend } from "@opensendcc/sdk"
import { createMcpServer } from "../server.js"
import type { ServerOptions } from "../types.js"

export async function runStdio(
  opensend: Opensend,
  options: ServerOptions
): Promise<void> {
  serveStdio(() => createMcpServer(opensend, options), {
    legacy: "serve",
    onerror: (error) => console.error("stdio connection error:", error),
  })
  console.error("Opensend MCP Server running on stdio")
}
