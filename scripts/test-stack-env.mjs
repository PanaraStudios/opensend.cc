import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

// Keep the real telemetry path enabled, but never contact the public collector.
export const testStackEnv = Object.freeze({
  OPENSEND_TELEMETRY: "1",
  OPENSEND_TELEMETRY_URL: "http://127.0.0.1:9/telemetry",
})

export function writeTestStackEnv(filename, values = {}) {
  mkdirSync(dirname(filename), { recursive: true })
  writeFileSync(
    filename,
    Object.entries({ ...values, ...testStackEnv })
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
}
