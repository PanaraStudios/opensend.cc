import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs"
import { spawn, spawnSync } from "node:child_process"
import { resolve } from "node:path"
const filename = resolve(".env.playwright")
const project = "opensend-e2e"
const parse = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=")
        return [l.slice(0, i), l.slice(i + 1)]
      })
  )
function run(command, args, env = process.env) {
  const r = spawnSync(command, args, { env, stdio: "inherit" })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${command} failed (${r.status})`)
}
const compose = [
  "compose",
  "--env-file",
  filename,
  "-p",
  project,
  "--profile",
  "oidc-test",
]
if (existsSync(filename)) {
  if (parse(readFileSync(filename, "utf8")).INSTANCE_NAME !== project)
    throw new Error("Refusing to reset a non-test instance")
  run("docker", [...compose, "down", "--volumes"])
}
const local = existsSync(".env.docker")
  ? parse(readFileSync(".env.docker", "utf8"))
  : {}
const values = {
  INSTANCE_NAME: project,
  INSTANCE_SECRET: randomBytes(32).toString("hex"),
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  SSO_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  SITE_URL: "http://localhost:3400",
  APP_PORT: "3400",
  CONVEX_PORT: "3410",
  CONVEX_SITE_PORT: "3411",
  DASHBOARD_PORT: "6792",
  OIDC_PORT: "8180",
  CONVEX_PUBLIC_URL: "http://localhost:3410",
  CONVEX_PUBLIC_SITE_URL: "http://host.docker.internal:3411",
  ALLOW_LOCAL_OIDC: "true",
  ...(process.env.E2E_CONVEX_IMAGE || local.CONVEX_IMAGE
    ? { CONVEX_IMAGE: process.env.E2E_CONVEX_IMAGE || local.CONVEX_IMAGE }
    : {}),
  ...(process.env.E2E_DASHBOARD_IMAGE || local.CONVEX_DASHBOARD_IMAGE
    ? {
        CONVEX_DASHBOARD_IMAGE:
          process.env.E2E_DASHBOARD_IMAGE || local.CONVEX_DASHBOARD_IMAGE,
      }
    : {}),
}
writeFileSync(
  filename,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 }
)
const env = {
  ...process.env,
  OPENSEND_ENV_FILE: filename,
  COMPOSE_PROJECT_NAME: project,
}
mkdirSync("test-results", { recursive: true })
let logs
let status = 1
try {
  run("node", ["scripts/setup.mjs"], env)
  run("docker", [...compose, "up", "-d", "oidc"])
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(
        "http://localhost:8180/realms/opensend/.well-known/openid-configuration"
      )
      if (r.ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (!ready) throw new Error("OIDC test provider did not start")
  const logPath = resolve("test-results/auth-function-logs.jsonl")
  const fd = openSync(logPath, "w", 0o600)
  logs = spawn("pnpm", ["backend", "logs", "--jsonl"], {
    env,
    stdio: ["ignore", fd, "inherit"],
    detached: true,
  })
  closeSync(fd)
  const result = await new Promise((resolve) => {
    const tests = spawn("pnpm", ["exec", "playwright", "test"], {
      env: { ...env, OPENSEND_TEST_LOG: logPath },
      stdio: "inherit",
    })
    tests.on("exit", (code) => resolve(code ?? 1))
    tests.on("error", () => resolve(1))
  })
  status = result
} finally {
  if (logs?.pid) {
    try {
      process.kill(-logs.pid, "SIGTERM")
    } catch {}
  }
  if (process.env.OPENSEND_KEEP_E2E !== "1")
    run("docker", [...compose, "down", "--volumes"])
}
process.exit(status)
