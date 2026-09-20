import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
const filename = process.env.OPENSEND_ENV_FILE || ".env.docker"
const values = Object.fromEntries(
  readFileSync(filename, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=")
      return [line.slice(0, i), line.slice(i + 1)]
    })
)
if (!values.CONVEX_SELF_HOSTED_ADMIN_KEY)
  throw new Error("Run pnpm setup first")
const env = {
  ...process.env,
  CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${values.CONVEX_PORT || 3210}`,
  CONVEX_SELF_HOSTED_ADMIN_KEY: values.CONVEX_SELF_HOSTED_ADMIN_KEY,
}
delete env.CONVEX_DEPLOYMENT
delete env.CONVEX_DEPLOY_KEY
console.log(
  `Target: self-hosted ${values.INSTANCE_NAME} (${env.CONVEX_SELF_HOSTED_URL})`
)
const result = spawnSync("pnpm", ["exec", "convex", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
