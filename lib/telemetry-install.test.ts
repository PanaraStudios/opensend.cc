import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test, { type TestContext } from "node:test"
import { parse } from "../scripts/lib.mjs"

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "opensend-telemetry-install-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bin = join(directory, "bin")
  await mkdir(bin)
  // Only simulate the Docker boundary; execute the real installers and env writes.
  await writeFile(
    join(bin, "docker"),
    `#!/bin/sh
case "$*" in
  info) exit 0 ;;
  'compose version --short') echo 2.30.0 ;;
  *'config --images convex') echo convex:test ;;
  'run --rm --entrypoint ./generate_key '*) echo test-admin-key ;;
  *'up -d '*) exit 0 ;;
  *'ps -a -q migrate') echo test-migrate ;;
  'wait test-migrate') echo 0 ;;
  *) echo "Unexpected Docker operation: $*" >&2; exit 1 ;;
esac
`,
    { mode: 0o700 }
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
  }
  for (const key of Object.keys(env))
    if (
      key.startsWith("OPENSEND_") ||
      key.startsWith("CONVEX_") ||
      key.startsWith("COMPOSE_") ||
      key.endsWith("_IMAGE")
    )
      delete env[key]
  async function execute(command: string, args: string[], overrides = {}) {
    const child = spawn(command, args, {
      cwd: resolve("."),
      env: { ...env, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk))
    child.stderr.on("data", (chunk) => (output += chunk))
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", resolve)
    })
    assert.equal(code, 0, output)
  }
  const server = createServer(async (request, response) => {
    const asset = request.url!.slice(1)
    const paths: Record<string, string> = {
      "compose.yaml": "compose.yaml",
      "compose.caddy.yaml": "compose.caddy.yaml",
      "compose.cloud.yaml": "compose.cloud.yaml",
      "compose.cloud-caddy.yaml": "compose.cloud-caddy.yaml",
      Caddyfile: "docker/caddy/Caddyfile",
      "Caddyfile.cloud": "docker/caddy/Caddyfile.cloud",
    }
    if (!paths[asset]) return void response.writeHead(404).end()
    response.end(await readFile(paths[asset]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const installation = join(directory, "installation")
  return {
    directory,
    execute,
    settings: async () =>
      parse(await readFile(join(installation, ".env"), "utf8")),
    install: (command: string, args: string[] = [], overrides = {}) =>
      execute(
        "sh",
        [
          "scripts/install.sh",
          command,
          "--dir",
          installation,
          "--local",
          "--caddy",
          "no",
          "--yes",
          "--no-start",
          "--version",
          "v0.1.1",
          "--source-url",
          `http://127.0.0.1:${address.port}`,
          ...args,
        ],
        overrides
      ),
  }
}

for (const mode of ["self", "cloud"]) {
  test(`${mode} installer defaults on, preserves upgrades and accepts explicit telemetry overrides`, async (t) => {
    const f = await fixture(t)
    const cloud =
      mode === "cloud"
        ? ["--convex", mode, "--deploy-key", "dev:fake-name|token"]
        : []
    await f.install("install", cloud)
    const initial = await f.settings()
    assert.equal(initial.OPENSEND_TELEMETRY, "1")
    assert.equal(initial.OPENSEND_INSTALL_METHOD, "script")
    assert.equal(
      initial.OPENSEND_ARCH,
      process.arch === "arm64" ? "arm64" : "amd64"
    )
    await f.install("upgrade", ["--telemetry", "no"])
    assert.equal((await f.settings()).OPENSEND_TELEMETRY, "0")
    await f.install("upgrade", [], { OPENSEND_TELEMETRY: "1" })
    assert.equal((await f.settings()).OPENSEND_TELEMETRY, "0")
    await f.install("upgrade", ["--telemetry", "yes"])
    assert.equal((await f.settings()).OPENSEND_TELEMETRY, "1")
    assert.equal(
      (await f.settings()).BETTER_AUTH_SECRET,
      initial.BETTER_AUTH_SECRET
    )
  })
}

test("source setup persists telemetry defaults and preserves an existing hard off", async (t) => {
  const f = await fixture(t)
  const filename = join(f.directory, ".env.docker")
  await writeFile(filename, "CONVEX_SELF_HOSTED_ADMIN_KEY=test-admin-key\n")
  const env = {
    OPENSEND_ENV_FILE: filename,
    OPENSEND_BACKEND_ONLY: "1",
    OPENSEND_SKIP_BUILD: "1",
  }
  await f.execute(process.execPath, ["scripts/setup.mjs"], env)
  const defaults = parse(await readFile(filename, "utf8"))
  assert.equal(defaults.OPENSEND_TELEMETRY, "1")
  assert.equal(defaults.OPENSEND_INSTALL_METHOD, "source")
  await writeFile(
    filename,
    (await readFile(filename, "utf8")).replace(
      "OPENSEND_TELEMETRY=1",
      "OPENSEND_TELEMETRY=0"
    )
  )
  await f.execute(process.execPath, ["scripts/setup.mjs"], env)
  assert.equal(parse(await readFile(filename, "utf8")).OPENSEND_TELEMETRY, "0")
})
