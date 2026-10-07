import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "opensend-migrate-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const path of [
    "docker/migrate",
    "scripts",
    "lib",
    "node_modules/convex/bin",
  ])
    await mkdir(join(directory, path), { recursive: true })
  for (const path of [
    "docker/migrate/run.mjs",
    "scripts/convex-env.mjs",
    "lib/telemetry.ts",
  ])
    await copyFile(path, join(directory, path))
  await writeFile(
    join(directory, "node_modules/convex/package.json"),
    JSON.stringify({ name: "convex", type: "module" })
  )
  const callsFile = join(directory, "calls.jsonl")
  await writeFile(callsFile, "")
  await writeFile(
    join(directory, "node_modules/convex/bin/main.js"),
    `import { appendFileSync } from "node:fs"
appendFileSync(process.env.CALLS_FILE, JSON.stringify({
  args: process.argv.slice(2),
  url: process.env.CONVEX_SELF_HOSTED_URL,
  key: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY,
  deployment: process.env.CONVEX_DEPLOYMENT,
  deployKey: process.env.CONVEX_DEPLOY_KEY,
}) + "\\n")
if (process.argv[2] === process.env.FAIL_COMMAND) process.exit(7)
`
  )
  return {
    async run(args = [], env = {}) {
      const child = spawn(
        process.execPath,
        ["docker/migrate/run.mjs", ...args],
        {
          cwd: directory,
          env: {
            ...process.env,
            CALLS_FILE: callsFile,
            CONVEX_SELF_HOSTED_ADMIN_KEY: "test-admin-key",
            CONVEX_DEPLOYMENT: "must-not-use-cloud",
            CONVEX_DEPLOY_KEY: "",
            ...env,
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      )
      let stderr = ""
      child.stdout.resume()
      child.stderr.on("data", (chunk) => (stderr += chunk))
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("exit", resolve)
      })
      const calls = (await readFile(callsFile, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      return { code, stderr, calls }
    },
  }
}

test("waits for readiness, skips empty settings and deploys only to self-hosted", async (t) => {
  const f = await fixture(t)
  let requests = 0
  const server = createServer((req, res) => {
    assert.equal(req.url, "/version")
    res.writeHead(++requests === 1 ? 503 : 200).end("ready")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const { code, calls } = await f.run([], {
    CONVEX_SELF_HOSTED_URL: url,
    SITE_URL: "https://mail.example.test",
    BETTER_AUTH_SECRET: "",
    SMTP_HOST: "smtp.example.test",
    OPENSEND_TELEMETRY: "0",
    OPENSEND_TELEMETRY_URL: "http://127.0.0.1:9/telemetry",
    OPENSEND_INSTALL_METHOD: "script",
  })
  assert.equal(code, 0)
  assert.ok(requests >= 2)
  assert.ok(
    calls.some((call) => call.args[2] === "SMTP_HOST=smtp.example.test")
  )
  assert.ok(
    !calls.some((call) => call.args[2]?.startsWith("BETTER_AUTH_SECRET="))
  )
  assert.ok(calls.some((call) => call.args[2] === "OPENSEND_TELEMETRY=0"))
  assert.ok(
    calls.some(
      (call) =>
        call.args[2] === "OPENSEND_TELEMETRY_URL=http://127.0.0.1:9/telemetry"
    )
  )
  assert.ok(
    calls.some((call) => call.args[2] === "OPENSEND_INSTALL_METHOD=script")
  )
  assert.deepEqual(calls.at(-1).args, [
    "deploy",
    "--yes",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ])
  for (const call of calls) {
    assert.equal(call.url, url)
    assert.equal(call.key, "test-admin-key")
    assert.equal(call.deployment, undefined)
    assert.equal(call.deployKey, undefined)
  }
})

test("passes CLI arguments through without waiting or deploying", async (t) => {
  const f = await fixture(t)
  const args = ["export", "--path", "/backup/with spaces.zip"]
  const { code, calls } = await f.run(args, {
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:1",
  })
  assert.equal(code, 0)
  assert.deepEqual(
    calls.map((call) => call.args),
    [args]
  )
})

test("reports CLI failures and rejects missing credentials", async (t) => {
  const f = await fixture(t)
  const failed = await f.run(["env", "list"], { FAIL_COMMAND: "env" })
  assert.equal(failed.code, 1)
  assert.match(failed.stderr, /Convex env failed \(7\)/)
  const missing = await f.run(["logs"], { CONVEX_SELF_HOSTED_ADMIN_KEY: "" })
  assert.equal(missing.code, 1)
  assert.match(
    missing.stderr,
    /CONVEX_SELF_HOSTED_ADMIN_KEY.*CONVEX_DEPLOY_KEY.*required/
  )
  assert.equal(missing.calls.length, 1)
})

test("cloud deploy skips readiness and selects only the deploy key", async (t) => {
  const f = await fixture(t)
  const { code, calls } = await f.run([], {
    CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:1",
    CONVEX_DEPLOY_KEY: "dev:fake-name|token",
    SITE_URL: "https://mail.example.test",
    OPENSEND_TELEMETRY: "0",
  })
  assert.equal(code, 0)
  assert.ok(calls.some((call) => call.args[2] === "OPENSEND_TELEMETRY=0"))
  assert.ok(
    calls.some((call) => call.args[2] === "SITE_URL=https://mail.example.test")
  )
  assert.deepEqual(calls.at(-1).args, [
    "deploy",
    "--yes",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ])
  for (const call of calls) {
    assert.equal(call.url, undefined)
    assert.equal(call.key, "")
    assert.equal(call.deployment, undefined)
    assert.equal(call.deployKey, "dev:fake-name|token")
  }
})

test("cloud passes logs, export, import and env list through", async (t) => {
  for (const args of [
    ["logs"],
    ["export", "--path", "/backup.zip"],
    ["import", "/backup.zip"],
    ["env", "list"],
  ]) {
    const f = await fixture(t)
    const { code, calls } = await f.run(args, {
      CONVEX_SELF_HOSTED_ADMIN_KEY: "",
      CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:1",
      CONVEX_DEPLOY_KEY: "dev:fake-name|token",
    })
    assert.equal(code, 0)
    assert.deepEqual(
      calls.map((call) => call.args),
      [args]
    )
    assert.equal(calls[0].deployKey, "dev:fake-name|token")
    assert.equal(calls[0].url, undefined)
  }
})

test("rejects both credential modes before calling the CLI", async (t) => {
  const f = await fixture(t)
  const { code, stderr, calls } = await f.run(["logs"], {
    CONVEX_DEPLOY_KEY: "dev:fake-name|token",
  })
  assert.equal(code, 1)
  assert.match(
    stderr,
    /only one.*CONVEX_SELF_HOSTED_ADMIN_KEY.*CONVEX_DEPLOY_KEY/
  )
  assert.deepEqual(calls, [])
})

test("rejects neither credential mode before calling the CLI", async (t) => {
  const f = await fixture(t)
  const { code, stderr, calls } = await f.run(["logs"], {
    CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    CONVEX_DEPLOY_KEY: "",
  })
  assert.equal(code, 1)
  assert.match(
    stderr,
    /CONVEX_SELF_HOSTED_ADMIN_KEY.*CONVEX_DEPLOY_KEY.*required/
  )
  assert.deepEqual(calls, [])
})

test("deploys a normalized override, baked release or unknown version", async (t) => {
  const server = createServer((_req, res) => res.writeHead(200).end("ready"))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  for (const [version, baked, expected] of [
    ["v0.1.1", "v2.0.0-rc.1", "0.1.1"],
    ["0.1.1", "v2.0.0-rc.1", "0.1.1"],
    ["latest", "v2.0.0-rc.1", "2.0.0-rc.1"],
    ["", "v2.0.0-rc.1", "2.0.0-rc.1"],
    [undefined, "v2.0.0-rc.1", "2.0.0-rc.1"],
    ["latest", "", "0.0.0-unknown"],
  ]) {
    const f = await fixture(t)
    const { code, calls } = await f.run([], {
      CONVEX_SELF_HOSTED_URL: url,
      OPENSEND_VERSION: version,
      OPENSEND_RELEASE_VERSION: baked,
    })
    assert.equal(code, 0)
    assert.ok(
      calls.some((call) => call.args[2] === `OPENSEND_VERSION=${expected}`)
    )
    assert.ok(
      !calls.some((call) =>
        call.args[2]?.startsWith("OPENSEND_RELEASE_VERSION=")
      )
    )
    assert.equal(calls.at(-1).args[0], "deploy")
  }
})
