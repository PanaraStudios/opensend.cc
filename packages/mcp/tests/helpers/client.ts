import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { Opensend } from "@opensendcc/sdk"
import { createMcpServer } from "../../src/server.js"
import { USER_AGENT } from "../../src/user-agent.js"

export const fakeKey = "os_test0000000000000000000000000000"
export const baseUrl = "https://api.opensend.test"

export async function connectClient(key = fakeKey, origin = baseUrl) {
  const server = createMcpServer(
    new Opensend(key, { baseUrl: origin, userAgent: USER_AGENT }),
    {}
  )
  const client = new Client({ name: "opensend-test", version: "0.0.0" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}
