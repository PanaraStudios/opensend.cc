import { spawn } from "node:child_process"
import { basename, resolve } from "node:path"

const OUTPUT_TAIL = 4096

export function redactOutput(output, secrets = []) {
  let text = String(output)
  // Redact before taking tails, including credentials spanning data chunks.
  for (const secret of [...new Set(secrets)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[REDACTED]")
    const escaped = JSON.stringify(secret).slice(1, -1)
    if (escaped !== secret) text = text.split(escaped).join("[REDACTED]")
  }
  return text
    .replace(/\b(?:os_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9+/=_-]+)/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
}

export function convexCliCommand(root, args) {
  // Never involve a package manager in a copied app with shared node_modules.
  return {
    command: process.execPath,
    args: [resolve(root, "node_modules/convex/bin/main.js"), ...args],
  }
}

/** Capture both streams for safe failure diagnostics. No arguments are logged.
 * Successful captured stdout stays raw for JSON/admin-key parsing; it isn't
 * printed. Other output and failure tails are redacted before being printed.
 */
export function runCommand(
  command,
  args,
  {
    cwd,
    childEnv = process.env,
    capture = false,
    quiet = false,
    label = basename(command),
    secrets = [],
    heartbeatText = `WAIT ${label}`,
    heartbeatMs = 30_000,
    onStart = () => {},
    onEnd = () => {},
  } = {}
) {
  const credentials = [
    ...secrets,
    ...Object.entries(childEnv)
      .filter(([key]) =>
        /secret|password|token|(?:api|admin|encryption).?key/i.test(key)
      )
      .map(([, value]) => value)
      .filter((value) => typeof value === "string"),
  ]
  const redact = (text) => redactOutput(text, credentials)
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    })
    onStart(child)
    let output = ""
    let errors = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      errors += chunk
    })
    const heartbeat = setInterval(
      () => console.log(redact(heartbeatText)),
      heartbeatMs
    )
    child.once("error", (error) => {
      clearInterval(heartbeat)
      onEnd()
      reject(new Error(`${label} failed to start: ${redact(error.message)}`))
    })
    // "exit" can precede the last stdout/stderr data events.
    child.once("close", (code) => {
      clearInterval(heartbeat)
      onEnd()
      if (code === 0) {
        if (!quiet) {
          if (!capture && output) process.stdout.write(redact(output))
          if (errors) process.stderr.write(redact(errors))
        }
        resolveResult(output.trim())
      } else {
        const tails = [
          output && `stdout (tail):\n${redact(output).slice(-OUTPUT_TAIL)}`,
          errors && `stderr (tail):\n${redact(errors).slice(-OUTPUT_TAIL)}`,
        ].filter(Boolean)
        reject(
          new Error(
            `${label} failed (${code})${tails.length ? "\n" + tails.join("\n") : ""}`
          )
        )
      }
    })
  })
}
