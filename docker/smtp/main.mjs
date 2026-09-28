import { readFileSync } from "node:fs"
import { createSmtpServer, MAX_MESSAGE_BYTES } from "./server.mjs"

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const options = {
  convexSiteUrl: required("SMTP_CONVEX_SITE_URL"),
  name: required("SMTP_HOST"),
  key: readFileSync(required("SMTP_TLS_KEY_PATH")),
  cert: readFileSync(required("SMTP_TLS_CERT_PATH")),
  maxMessageBytes: Number(
    process.env.SMTP_MAX_MESSAGE_BYTES ?? MAX_MESSAGE_BYTES
  ),
}
const servers = [
  [true, Number(process.env.SMTP_TLS_PORT ?? 2465)],
  [false, Number(process.env.SMTP_STARTTLS_PORT ?? 2587)],
].map(([secure, port]) => {
  const server = createSmtpServer({ ...options, secure })
  server.on("error", () => {
    console.error("SMTP listener failed")
    process.exit(1)
  })
  server.listen(port, "0.0.0.0")
  return server
})
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    for (const server of servers) server.close()
  })
