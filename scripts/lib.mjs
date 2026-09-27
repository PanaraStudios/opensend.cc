import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createServer } from "node:net"

/** Reads KEY=value lines, skipping blanks, comments and anything else. */
export function parse(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=")
        return [line.slice(0, i), line.slice(i + 1)]
      })
  )
}

/** Runs a command to completion; returns its stdout when that is piped. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`)
  return result.stdout?.trim()
}

export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return String(port)
}

/** Tears down a disposable test instance and its volumes, but only while
    both its env file and its Docker volume still belong to `project`. */
export function removeTestInstance(envFile, project, compose) {
  if (
    parse(readFileSync(envFile, "utf8")).INSTANCE_NAME !== project ||
    !project.startsWith("opensend-e2e-")
  )
    throw new Error("Refusing cleanup: test ownership changed")
  const volume = spawnSync(
    "docker",
    [
      "volume",
      "inspect",
      `${project}_convex-data`,
      "--format",
      '{{ index .Labels "com.docker.compose.project" }}',
    ],
    { encoding: "utf8" }
  )
  if (volume.status === 0 && volume.stdout.trim() !== project)
    throw new Error("Refusing cleanup: Docker volume ownership changed")
  run("docker", [...compose, "down", "--volumes"])
}
