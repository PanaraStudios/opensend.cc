import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { assertTestCompose, testProject } from "./test-compose.mjs"

test("Compose guard rejects the live project at every precedence level", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "compose-guard-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, ".env"), "COMPOSE_PROJECT_NAME=opensend\n")
  for (const [args, env] of [
    [["compose", "down"], {}],
    [["compose", "down"], { COMPOSE_PROJECT_NAME: "opensend" }],
    [["compose", "-p", "opensend", "down"], { COMPOSE_PROJECT_NAME: "safe" }],
    [["compose", "--project-name=opensend", "up"], {}],
  ])
    assert.throws(
      () => assertTestCompose(args, env, dir),
      /Refusing test Docker Compose command: project opensend/
    )
  const project = testProject("install-cloud")
  writeFileSync(join(dir, ".env"), `COMPOSE_PROJECT_NAME=${project}\n`)
  assert.equal(assertTestCompose(["compose", "down"], {}, dir), project)
  assert.equal(
    assertTestCompose(
      ["compose", "-p", project, "down"],
      { COMPOSE_PROJECT_NAME: "opensend" },
      dir
    ),
    project
  )
  rmSync(join(dir, ".env"))
  assert.throws(
    () => assertTestCompose(["compose", "up"], {}, dir),
    /project opensend/
  )
  assert.notEqual(testProject("install-cloud"), project)
})

test("Docker wrapper blocks unsafe child calls and forwards isolated ones", async (t) => {
  const { chmodSync, mkdirSync, readFileSync } = await import("node:fs")
  const { spawnSync } = await import("node:child_process")
  const { guardedDockerEnv } = await import("./test-compose.mjs")
  const dir = mkdtempSync(join(tmpdir(), "compose-wrapper-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bin = join(dir, "bin")
  mkdirSync(bin)
  const log = join(dir, "called")
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`
  )
  chmodSync(join(bin, "docker"), 0o700)
  const env = guardedDockerEnv(dir, {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    COMPOSE_PROJECT_NAME: "opensend",
  })
  const unsafe = spawnSync("docker", ["compose", "down"], {
    env,
    cwd: dir,
    encoding: "utf8",
  })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /Refusing test Docker Compose/)
  const safe = spawnSync(
    "docker",
    ["compose", "-p", testProject("wrapper"), "down"],
    { env, cwd: dir, encoding: "utf8" }
  )
  assert.equal(safe.status, 0, safe.stderr)
  assert.match(readFileSync(log, "utf8"), /compose -p opensend-wrapper-.* down/)
})
