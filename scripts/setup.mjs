import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { parse } from "./lib.mjs"
const filename = resolve(process.env.OPENSEND_ENV_FILE || ".env.docker")
const env = existsSync(filename) ? parse(readFileSync(filename, "utf8")) : {}
const defaults = {
  INSTANCE_NAME: "opensend",
  INSTANCE_SECRET: randomBytes(32).toString("hex"),
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  SSO_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  SITE_URL: "http://localhost:3000",
  CONVEX_PUBLIC_URL: "http://localhost:3210",
  CONVEX_PUBLIC_SITE_URL: "http://localhost:3211",
}
for (const [key, value] of Object.entries(defaults)) env[key] ||= value
/** A loopback origin rewritten to reach the host from inside a container, or
    undefined when `url` is not on loopback. */
function hostOrigin(url) {
  const origin = new URL(url)
  if (!["localhost", "127.0.0.1"].includes(origin.hostname)) return undefined
  origin.hostname = "host.docker.internal"
  return origin.origin
}
// The backend fetches Better Auth signing keys from this advertised HTTP origin.
// With remapped Docker ports, localhost points back into the container instead
// of the host. Browser auth requests already use the Next.js proxy.
env.CONVEX_PUBLIC_SITE_URL =
  hostOrigin(env.CONVEX_PUBLIC_SITE_URL) ?? env.CONVEX_PUBLIC_SITE_URL
// Node action callbacks use Convex's advertised origin from inside Docker.
// A published localhost port is on the host, not the backend container.
env.CONVEX_BACKEND_ORIGIN ||=
  hostOrigin(env.CONVEX_PUBLIC_URL) ?? new URL(env.CONVEX_PUBLIC_URL).origin
function persist() {
  writeFileSync(
    filename,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
  chmodSync(filename, 0o600)
}
persist()
const compose = [
  "compose",
  "--env-file",
  filename,
  ...(process.env.COMPOSE_PROJECT_NAME
    ? ["-p", process.env.COMPOSE_PROJECT_NAME]
    : []),
]
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`)
  return result.stdout?.trim()
}
console.log(
  `Target: self-hosted local deployment ${env.INSTANCE_NAME} (${env.CONVEX_PUBLIC_URL})`
)
run("docker", [...compose, "up", "-d", "--wait", "convex"])
if (!env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
  env.CONVEX_SELF_HOSTED_ADMIN_KEY = run(
    "docker",
    [...compose, "exec", "-T", "convex", "./generate_admin_key.sh"],
    { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }
  )
  persist()
}
const cliEnv = {
  ...process.env,
  CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${env.CONVEX_PORT || 3210}`,
  CONVEX_SELF_HOSTED_ADMIN_KEY: env.CONVEX_SELF_HOSTED_ADMIN_KEY,
}
delete cliEnv.CONVEX_DEPLOYMENT
delete cliEnv.CONVEX_DEPLOY_KEY
for (const key of [
  "SITE_URL",
  "BETTER_AUTH_SECRET",
  "SSO_ENCRYPTION_KEY",
  "SES_ENCRYPTION_KEY",
  "SES_CALLBACK_ORIGIN",
  "ALLOW_LOCAL_OIDC",
])
  if (env[key])
    run("pnpm", ["exec", "convex", "env", "set", `${key}=${env[key]}`], {
      env: cliEnv,
    })
run("pnpm", ["exec", "convex", "deploy", "--yes"], { env: cliEnv })
if (process.env.OPENSEND_BACKEND_ONLY !== "1")
  run("docker", [
    ...compose,
    "up",
    "-d",
    ...(process.env.OPENSEND_SKIP_BUILD === "1" ? [] : ["--build"]),
    "--wait",
    "app",
    "dashboard",
  ])
console.log(
  `Opensend is ready at ${env.SITE_URL}. Create the first account at /signup. Auth links appear in Convex function logs.`
)
