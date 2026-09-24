import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs"
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { freePort, parse, removeTestInstance, run } from "./lib.mjs"
const project = `opensend-e2e-${Date.now()}-${randomBytes(3).toString("hex")}`
const filename = resolve(`.env.playwright-${project}`)
const [appPort, convexPort, sitePort, dashboardPort, oidcPort] =
  await Promise.all(Array.from({ length: 5 }, freePort))
const resultDir = resolve("test-results", project)
mkdirSync(resultDir, { recursive: true })
const realm = JSON.parse(readFileSync("docker/oidc-realm.json", "utf8"))
realm.clients[0].redirectUris = [
  `http://localhost:${appPort}/api/auth/oauth2/callback/*`,
]
realm.clients[0].webOrigins = [`http://localhost:${appPort}`]
const realmFile = resolve(resultDir, "oidc-realm.json")
writeFileSync(realmFile, JSON.stringify(realm), { mode: 0o600 })
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
  SITE_URL: `http://localhost:${appPort}`,
  APP_PORT: appPort,
  CONVEX_PORT: convexPort,
  CONVEX_SITE_PORT: sitePort,
  DASHBOARD_PORT: dashboardPort,
  OIDC_PORT: oidcPort,
  OIDC_REALM_FILE: realmFile,
  APP_IMAGE: process.env.APP_IMAGE || "opensend-app:local",
  CONVEX_PUBLIC_URL: `http://localhost:${convexPort}`,
  // Exercise setup's Docker loopback normalization with a remapped host port.
  CONVEX_PUBLIC_SITE_URL: `http://localhost:${sitePort}`,
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
  OPENSEND_BASE_URL: values.SITE_URL,
  OPENSEND_CONVEX_URL: values.CONVEX_PUBLIC_URL,
  OPENSEND_CALLBACK_ORIGIN: values.CONVEX_PUBLIC_SITE_URL,
  OPENSEND_OIDC_URL: `http://host.docker.internal:${oidcPort}/realms/opensend`,
  OPENSEND_TEST_RESULTS: resultDir,
}
mkdirSync("test-results", { recursive: true })
let logs
let status = 1
try {
  run("node", ["scripts/setup.mjs"], { env })
  // Setup may normalize a loopback URL for requests originating inside Docker.
  env.OPENSEND_CALLBACK_ORIGIN = parse(
    readFileSync(filename, "utf8")
  ).CONVEX_PUBLIC_SITE_URL
  run("docker", [...compose, "up", "-d", "oidc"])
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(
        `http://localhost:${oidcPort}/realms/opensend/.well-known/openid-configuration`
      )
      if (r.ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (!ready) throw new Error("OIDC test provider did not start")
  const logPath = resolve(resultDir, "auth-function-logs.jsonl")
  const fd = openSync(logPath, "w", 0o600)
  logs = spawn("pnpm", ["backend", "logs", "--jsonl"], {
    env,
    stdio: ["ignore", fd, "inherit"],
    detached: true,
  })
  closeSync(fd)
  const result = await new Promise((resolve) => {
    const tests = spawn(
      "pnpm",
      ["exec", "playwright", "test", ...process.argv.slice(2)],
      {
        env: { ...env, OPENSEND_TEST_LOG: logPath },
        stdio: "inherit",
      }
    )
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
    removeTestInstance(filename, project, compose)
}
process.exit(status)
