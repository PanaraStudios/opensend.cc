import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
const filename = resolve(process.env.OPENSEND_ENV_FILE || ".env.docker")
function parse(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=")
        return [l.slice(0, i), l.slice(i + 1)]
      })
  )
}
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
  "ALLOW_LOCAL_OIDC",
])
  if (env[key])
    run("pnpm", ["exec", "convex", "env", "set", `${key}=${env[key]}`], {
      env: cliEnv,
    })
run("pnpm", ["exec", "convex", "deploy", "--yes"], { env: cliEnv })
run("docker", [...compose, "up", "-d", "--build", "--wait", "app", "dashboard"])
console.log(
  `Opensend is ready at ${env.SITE_URL}. Create the first account at /signup. Auth links appear in Convex function logs.`
)
