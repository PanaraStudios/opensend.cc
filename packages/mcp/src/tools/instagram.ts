import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { addPageMessagingTools } from "./pageMessaging.js"
export function addInstagramTools(server: McpServer, opensend: Opensend) {
  addPageMessagingTools(server, opensend, "instagram")
}
