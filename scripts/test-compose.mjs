import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "./lib.mjs"

export function testProject(lane) {
  return `opensend-${lane}-${Date.now()}-${randomBytes(3).toString("hex")}`
}

// Mirror Compose's project precedence: -p, shell, env file, then the
// application's default name. Check inside Docker's wrapper so installer
// subprocesses that clear their environment are covered too.
export function assertTestCompose(
  args,
  env = process.env,
  cwd = process.cwd()
) {
  if (args[0] !== "compose" || args.includes("version")) return
  const option = (...names) => {
    for (let i = 1; i < args.length; i++) {
      for (const name of names) {
        if (args[i] === name) return args[i + 1]
        if (args[i].startsWith(`${name}=`))
          return args[i].slice(name.length + 1)
      }
    }
  }
  const directory = resolve(cwd, option("--project-directory") || ".")
  const filename = resolve(
    cwd,
    option("--env-file") || resolve(directory, ".env")
  )
  const saved = existsSync(filename)
    ? parse(readFileSync(filename, "utf8"))
    : {}
  const project =
    option("-p", "--project-name") ||
    env.COMPOSE_PROJECT_NAME ||
    saved.COMPOSE_PROJECT_NAME ||
    "opensend"
  if (project === "opensend")
    throw new Error(
      "Refusing test Docker Compose command: project opensend may be a live installation. Set a unique COMPOSE_PROJECT_NAME in the test env file and child environment."
    )
  return project
}

export function guardedDockerEnv(directory, env = process.env) {
  const docker = spawnSync("sh", ["-c", "command -v docker"], {
    env,
    encoding: "utf8",
  }).stdout.trim()
  if (!docker) throw new Error("Docker CLI is required for stack tests")
  const bin = resolve(directory, "guard-bin")
  mkdirSync(bin, { recursive: true })
  const wrapper = resolve(bin, "docker")
  writeFileSync(
    wrapper,
    `#!${process.execPath}
import ${JSON.stringify(fileURLToPath(import.meta.url))}
`
  )
  chmodSync(wrapper, 0o700)
  return { ...env, PATH: `${bin}:${env.PATH}`, TEST_STACK_DOCKER: docker }
}

// Also used by the shell calling harness, after creating its secrets file.
if (process.argv[2] === "--calling") {
  const args = [
    "compose",
    "--env-file",
    ".env.calling-test",
    "-f",
    "compose.yaml",
    "-f",
    "docker/compose.calling-test.yaml",
    "--profile",
    "calling",
    "--profile",
    "calling-test",
    "-p",
    process.env.COMPOSE_PROJECT_NAME,
    ...process.argv.slice(3),
  ]
  assertTestCompose(args)
  const result = spawnSync("docker", args, { stdio: "inherit" })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} else if (process.argv[2] === "--save-project") {
  const filename = process.argv[3]
  const project = process.env.COMPOSE_PROJECT_NAME
  assertTestCompose(["compose", "-p", project || "opensend"])
  const saved = existsSync(filename)
    ? parse(readFileSync(filename, "utf8"))
    : {}
  writeFileSync(
    filename,
    Object.entries({ ...saved, COMPOSE_PROJECT_NAME: project })
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
  chmodSync(filename, 0o600)
} else if (
  process.env.TEST_STACK_DOCKER &&
  process.argv[1]?.endsWith("/guard-bin/docker")
) {
  const args = process.argv.slice(2)
  assertTestCompose(args)
  const result = spawnSync(process.env.TEST_STACK_DOCKER, args, {
    stdio: "inherit",
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
