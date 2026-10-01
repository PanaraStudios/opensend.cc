import { McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import packageJson from "../package.json" with { type: "json" }
import {
  addVoiceTools,
  addMediaTools,
  addApiKeyTools,
  addAutomationTools,
  addBroadcastTools,
  addContactImportTools,
  addContactPropertyTools,
  addContactTools,
  addDomainTools,
  addEmailTools,
  addEventTools,
  addLogTools,
  addOAuthGrantTools,
  addSegmentTools,
  addSuppressionTools,
  addTemplateTools,
  addTopicTools,
  addUsageTools,
  addWebhookTools,
  addChannelTools,
  addChannelControlTools,
  addCallingTools,
  channelToolOptions,
} from "./tools/index.js"
import type { ServerOptions } from "./types.js"

export type { ServerOptions } from "./types.js"

export function createMcpServer(
  opensend: Opensend,
  options: ServerOptions
): McpServer {
  const { senderEmailAddress, replierEmailAddresses = [] } = options
  const server = new McpServer(
    {
      name: "opensend",
      version: packageJson.version,
    },
    {
      instructions:
        "Manage your self-hosted Opensend installation through its REST API. Use raw resource IDs (template aliases are also accepted), HTML/text templates and broadcasts. Hosted editor tools and dashboard URL inputs are unavailable.",
    }
  )

  addMediaTools(server, opensend)
  addApiKeyTools(server, opensend)
  addAutomationTools(server, opensend)
  addBroadcastTools(server, opensend, {
    senderEmailAddress,
    replierEmailAddresses,
  })
  addContactImportTools(server, opensend)
  addContactPropertyTools(server, opensend)
  addContactTools(server, opensend)
  addDomainTools(server, opensend)
  addEmailTools(server, opensend, { senderEmailAddress, replierEmailAddresses })
  addEventTools(server, opensend)
  addLogTools(server, opensend)
  addOAuthGrantTools(server, opensend)
  addSegmentTools(server, opensend)
  addSuppressionTools(server, opensend)
  addTemplateTools(server, opensend)
  addTopicTools(server, opensend)
  addUsageTools(server, opensend)
  addWebhookTools(server, opensend)
  addChannelControlTools(server, opensend)
  addCallingTools(server, opensend)
  addVoiceTools(server, opensend)
  for (const options of Object.values(channelToolOptions))
    addChannelTools(server, opensend, options)
  return server
}
