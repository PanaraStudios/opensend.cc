import { randomBytes } from "node:crypto"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

/** True when the Compose file list includes the production overlay. */
export function usesProductionOverlay(env) {
  return String(env.COMPOSE_FILE ?? "")
    .split(/[:;]/)
    .some((file) => file.endsWith("compose.prod.yaml"))
}

/** Secrets only the production overlay needs. Hex keeps the password safe
    inside POSTGRES_URL, which is not percent-decoded by the backend. */
export function productionDefaults(env) {
  return usesProductionOverlay(env)
    ? { POSTGRES_PASSWORD: randomBytes(24).toString("hex") }
    : {}
}

/** Services setup starts after a successful deploy, without waiting on their
    health: the backup service is healthy only once its first dump is due. */
export function productionServices(env) {
  return usesProductionOverlay(env) ? ["backup"] : []
}

/** Creates the host directory the backup service mounts (`BACKUP_DIR`,
    relative to the Compose project directory) as the user running setup.
    Docker would otherwise create it as root, leaving dumps the deploy user's
    upload cron and scripts/prod-backup.sh cannot read or write. */
export function prepareBackupDir(env, projectDir) {
  if (!usesProductionOverlay(env)) return undefined
  const dir = resolve(projectDir, env.BACKUP_DIR || "backups")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Problems that make a production overlay start unsafe. Empty when fine. */
export function productionProblems(env) {
  if (!usesProductionOverlay(env)) return []
  const problems = []
  const password = env.POSTGRES_PASSWORD ?? ""
  if (!/^[A-Za-z0-9_-]{24,}$/.test(password))
    problems.push(
      "POSTGRES_PASSWORD must be at least 24 URL-safe characters (openssl rand -hex 24)"
    )
  for (const key of ["SITE_URL", "CONVEX_PUBLIC_URL", "CONVEX_PUBLIC_SITE_URL"])
    if (!/^https:\/\//.test(env[key] ?? ""))
      problems.push(`${key} must be an https:// URL in production`)
  for (const key of ["LOG_AUTH_LINKS", "ALLOW_LOCAL_OIDC", "META_GRAPH_ORIGIN"])
    if (env[key]) problems.push(`${key} must be unset in production`)
  const name = (env.INSTANCE_NAME ?? "opensend").replaceAll("-", "_")
  if ((env.POSTGRES_DB ?? "opensend") !== name)
    problems.push(
      `POSTGRES_DB must be ${name} (INSTANCE_NAME with "-" replaced by "_")`
    )
  return problems
}
