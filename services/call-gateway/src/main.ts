import { config } from "./config.js"
import { CallController } from "./controller.js"
import { createGatewayServer } from "./server.js"

import { AgentSessions } from "./agents.js"

const options = config()
const controller = new CallController(options)
await controller.start()
const server = createGatewayServer(controller, options.secret, {
  sessions: new AgentSessions(),
  directorySecret: process.env.FREESWITCH_DIRECTORY_SECRET ?? "",
  sipSecret: options.sipSecret,
  control: (request) => controller.control(request),
})
server.listen(options.port, "0.0.0.0", () =>
  console.log(`Call gateway listening on ${options.port}`)
)
let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  const forced = setTimeout(() => process.exit(1), 15000).unref()
  server.close()
  await controller.close()
  clearTimeout(forced)
}
process.on("SIGTERM", () => {
  void shutdown()
})
process.on("SIGINT", () => {
  void shutdown()
})
