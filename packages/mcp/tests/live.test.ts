import { expect, it } from "vitest"
import { connectClient } from "./helpers/client.js"

const origin = process.env.OPENSEND_BASE_URL_LIVE
const key = process.env.OPENSEND_API_KEY
it.skipIf(!origin || !key)(
  "reads a live installation through the MCP client",
  async () => {
    const connection = await connectClient(key!, origin!)
    try {
      for (const name of ["list-domains", "list-api-keys", "list-emails"]) {
        const result = await connection.client.callTool({ name, arguments: {} })
        expect(result.isError, name).toBeFalsy()
        expect(result.content.length).toBeGreaterThan(0)
      }
    } finally {
      await connection.close()
    }
  }
)
