import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "./lib.mjs"

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
  chmodSync(filename, 0o600)
}

// Shell harnesses repair reused env files without rotating their saved secrets.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const filename = process.argv[2]
  if (!filename) throw new Error("Supply a test stack environment file")
  writeTestStackEnv(
    filename,
    existsSync(filename) ? parse(readFileSync(filename, "utf8")) : {}
  )
}
