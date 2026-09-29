#!/usr/bin/env node
import { USER_AGENT } from "./user-agent.js"
import "dotenv/config"
import { Opensend } from "@opensend/sdk"
import { parseArgs, resolveConfigOrExit } from "./cli/index.js"
import { runHttp } from "./transports/http.js"
import { runStdio } from "./transports/stdio.js"

const parsed = parseArgs(process.argv.slice(2))
const config = resolveConfigOrExit(parsed, process.env)

const serverOptions = {
  senderEmailAddress: config.senderEmailAddress,
  replierEmailAddresses: config.replierEmailAddresses,
}

function onFatal(err: unknown): void {
  console.error(
    "Fatal error:",
    err instanceof Error ? err.message : "unexpected error"
  )
  process.exit(1)
}

process.on("SIGINT", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))

if (config.transport === "http") {
  // HTTP mode: no Opensend client needed at startup. Each connecting client
  // provides their own API key via the Authorization: Bearer header,
  // and a per-session Opensend client is created in the transport layer.
  runHttp(serverOptions, config.port, {
    baseUrl: config.baseUrl,
    host: config.host,
    allowedHosts: config.allowedHosts,
  }).catch(onFatal)
} else {
  // Stdio mode: single user, API key is required at startup.
  const opensend = new Opensend(config.apiKey, {
    baseUrl: config.baseUrl,
    userAgent: USER_AGENT,
  })
  runStdio(opensend, serverOptions).catch(onFatal)
}
