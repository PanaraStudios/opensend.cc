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
import { lookup } from "node:dns/promises"
import { resolve } from "node:path"
import { freePort, parse, removeTestInstance, run } from "./lib.mjs"
import { testStackEnv, writeTestStackEnv } from "./test-stack-env.mjs"
const project = `opensend-e2e-${Date.now()}-${randomBytes(3).toString("hex")}`
const filename = resolve(`.env.playwright-${project}`)
const [appPort, convexPort, sitePort, oidcPort] = await Promise.all(
  Array.from({ length: 4 }, freePort)
)
const resultDir = resolve("test-results", project)
mkdirSync(resultDir, { recursive: true })
const realm = JSON.parse(readFileSync("docker/oidc-realm.json", "utf8"))
realm.clients[0].redirectUris = [
  `http://localhost:${appPort}/api/auth/oauth2/callback/*`,
]
realm.clients[0].webOrigins = [`http://localhost:${appPort}`]
const realmFile = resolve(resultDir, "oidc-realm.json")
writeFileSync(realmFile, JSON.stringify(realm), { mode: 0o600 })
// Linux Docker has no host.docker.internal bridge to the host's loopback ports.
const linux = process.platform === "linux"
const composeFiles = linux
  ? ["compose.yaml", "tests/e2e/compose.linux.yaml"]
  : ["compose.yaml"]
let hostGateway
if (linux) {
  hostGateway = spawnSync(
    "docker",
    [
      "network",
      "inspect",
      "bridge",
      "-f",
      "{{(index .IPAM.Config 0).Gateway}}",
    ],
    { encoding: "utf8" }
  ).stdout.trim()
  if (!hostGateway) throw new Error("Could not find the Docker host gateway")
  // The browser and test runner open host.docker.internal URLs (OIDC) too.
  const { address } = await lookup("host.docker.internal").catch(() => ({}))
  if (address !== "127.0.0.1")
    throw new Error(
      "Add `127.0.0.1 host.docker.internal` to /etc/hosts to run e2e on Linux"
    )
}
const compose = [
  "compose",
  ...composeFiles.flatMap((file) => ["-f", file]),
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
  OIDC_PORT: oidcPort,
  OIDC_REALM_FILE: realmFile,
  APP_IMAGE: process.env.APP_IMAGE || "opensend-app:local",
  CONVEX_PUBLIC_URL: `http://localhost:${convexPort}`,
  // Exercise setup's Docker loopback normalization with a remapped host port.
  CONVEX_PUBLIC_SITE_URL: `http://localhost:${sitePort}`,
  ALLOW_LOCAL_OIDC: "true",
  // The suite reads invitation, verification and reset links from the logs.
  LOG_AUTH_LINKS: "true",
  ...(hostGateway ? { E2E_HOST_GATEWAY: hostGateway } : {}),
  ...(process.env.E2E_CONVEX_IMAGE || local.CONVEX_IMAGE
    ? { CONVEX_IMAGE: process.env.E2E_CONVEX_IMAGE || local.CONVEX_IMAGE }
    : {}),
}
writeTestStackEnv(filename, values)
const env = {
  ...process.env,
  ...testStackEnv,
  OPENSEND_ENV_FILE: filename,
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_FILE: composeFiles.join(":"),
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
