import assert from "node:assert/strict"
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parse } from "../scripts/lib.mjs"
import { testStackEnv, writeTestStackEnv } from "../scripts/test-stack-env.mjs"

test("test stack env keeps telemetry enabled and overrides inherited collector URLs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "opensend-test-env-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = join(directory, "installation", ".env")
  writeTestStackEnv(filename, {
    INSTANCE_NAME: "test-instance",
    OPENSEND_TELEMETRY: "0",
    OPENSEND_TELEMETRY_URL: "https://opensend.cc/api/telemetry",
  })
  const env = parse(await readFile(filename, "utf8"))
  assert.equal(env.INSTANCE_NAME, "test-instance")
  assert.equal(env.OPENSEND_TELEMETRY, "1")
  assert.equal(env.OPENSEND_TELEMETRY_URL, "http://127.0.0.1:9/telemetry")
  assert.equal((await stat(filename)).mode & 0o777, 0o600)
  const inherited: Record<string, string> = {
    OPENSEND_TELEMETRY_URL: "https://opensend.cc/api/telemetry",
  }
  assert.deepEqual({ ...inherited, ...testStackEnv }, testStackEnv)
  await chmod(filename, 0o644)
  writeTestStackEnv(filename, { ...env, OPENSEND_TELEMETRY: "0" })
  assert.deepEqual(parse(await readFile(filename, "utf8")), env)
  assert.equal((await stat(filename)).mode & 0o777, 0o600)
})

// Guard the wiring too: a safe helper is ineffective if a harness stops using it.
for (const [harness, writes, shellOverride] of [
  ["test-e2e", ["filename, values"], "...process.env,\n  ...testStackEnv,"],
  [
    "test-ses-restore",
    ["targetFile, target"],
    "...process.env,\n  ...testStackEnv,",
  ],
  [
    "test-install",
    [
      'resolve(configuration, ".env")',
      'resolve(cloudDirectory, ".env")',
      'resolve(directory, ".env")',
    ],
    "Object.assign(composeEnv, testStackEnv)",
  ],
] as const) {
  test(`${harness} redirects telemetry in every generated env and child environment`, async () => {
    const source = await readFile(`scripts/${harness}.mjs`, "utf8")
    for (const args of writes)
      assert.ok(source.includes(`writeTestStackEnv(${args})`), args)
    assert.ok(source.includes(shellOverride))
    assert.ok(source.includes("Object.assign(process.env, testStackEnv)"))
  })
}
