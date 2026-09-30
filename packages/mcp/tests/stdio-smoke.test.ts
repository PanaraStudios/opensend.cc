import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { fakeKey, baseUrl } from "./helpers/client.js"
import { toolNames, removedToolNames } from "./helpers/tool-names.js"

describe("stdio CLI", () => {
  it.each(["legacy", "modern"] as const)(
    "advertises the REST tools over %s stdio",
    async (era) => {
      const client = new Client(
        { name: "smoke", version: "0.0.0" },
        era === "modern"
          ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
          : {}
      )
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
        env: {
          OPENSEND_API_KEY: fakeKey,
          OPENSEND_BASE_URL: baseUrl,
          DOTENV_CONFIG_PATH: "/dev/null",
        },
        stderr: "pipe",
      })
      try {
        await client.connect(transport)
        expect(client.getServerVersion()?.name).toBe("opensend")
        const { tools } = await client.listTools()
        const names = tools.map((t) => t.name).sort()
        expect(names).toEqual([...toolNames])
        for (const name of removedToolNames) expect(names).not.toContain(name)
      } finally {
        await client.close()
        await transport.close()
      }
    }
  )
})
