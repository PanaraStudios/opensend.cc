import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { freePort, parse, removeTestInstance } from "./lib.mjs"
import { guardedDockerEnv } from "./test-compose.mjs"
import { testStackEnv, writeTestStackEnv } from "./test-stack-env.mjs"
import { CONVEX_ENV_KEYS } from "./convex-env.mjs"
import {
  prepareComponentMount,
  writeComponentFixtures,
} from "./convex-component-fixtures.mjs"
import { sesFixtureNotification } from "../tests/e2e/ses-fixture-data.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
if (resolve(process.cwd()) !== root)
  throw new Error("Run from the repository root")
const project = `opensend-e2e-component-${Date.now()}-${randomBytes(3).toString("hex")}`
const results = resolve("test-results", project)
const temporary = mkdtempSync(join(tmpdir(), `${project}-`))
const staging = join(temporary, "product")
const example = join(temporary, "example")
const filename = resolve(`.env.playwright-${project}`)
const [productPort, productSitePort, examplePort, exampleSitePort] =
  await Promise.all(Array.from({ length: 4 }, freePort))
const ports = { productPort, productSitePort, examplePort, exampleSitePort }
const composeOverride = join(results, "compose.yaml")
const apiKey = `os_${randomBytes(24).toString("hex")}`
const webhookSecret = `whsec_${randomBytes(32).toString("base64")}`
const instanceSecret = randomBytes(32).toString("hex")
const exampleSecret = randomBytes(32).toString("hex")
let env
let compose
let exampleEnv
let setupStarted = false
let activeChild
let exitStatus = 1
let interrupted = false

// Async commands keep signal handlers and the deadline heartbeat responsive.
function execute(
  command,
  args,
  { cwd = root, capture = false, childEnv = env, quiet = false } = {}
) {
  if (interrupted) return Promise.reject(new Error("Interrupted"))
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: [
        "ignore",
        capture || quiet ? "pipe" : "inherit",
        quiet ? "pipe" : "inherit",
      ],
    })
    activeChild = child
    let output = ""
    let errors = ""
    child.stdout?.on("data", (chunk) => {
      output += chunk
    })
    child.stderr?.on("data", (chunk) => {
      errors += chunk
    })
    const heartbeat = setInterval(
      () => console.log(`WAIT ${command} ${args[0]} (${project})`),
      30_000
    )
    child.once("error", (error) => {
      clearInterval(heartbeat)
      activeChild = undefined
      reject(error)
    })
    // Wait for stdout/stderr to close before parsing captured CLI JSON.
    child.once("close", (code) => {
      clearInterval(heartbeat)
      activeChild = undefined
      if (code === 0) resolveResult(output.trim())
      // Do not include command arguments: env set / seed carry test credentials.
      else
        reject(
          new Error(
            `${command} ${args[0]} failed (${code})${quiet ? `: ${errors}` : ""}`
          )
        )
    })
  })
}
const docker = (args) => execute("docker", [...compose, ...args])
const cli = (args, options = {}) =>
  execute("pnpm", ["exec", "convex", ...args], { capture: true, ...options })
const runProduct = async (name, args) =>
  JSON.parse(
    (await cli(["run", name, JSON.stringify(args)], {
      cwd: staging,
      quiet: true,
    })) || "null"
  )
const runExample = async (name, args) =>
  JSON.parse(
    (await cli(["run", name, JSON.stringify(args)], {
      cwd: example,
      childEnv: exampleEnv,
      quiet: true,
    })) || "null"
  )
function pass(label) {
  console.log(`PASS ${label}`)
}
async function poll(label, fn, accept, timeout = 90_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Interrupted")
    last = await fn()
    if (accept(last)) return last
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`)
}
async function ready(url) {
  await poll(
    `${url} ready`,
    async () => {
      try {
        const response = await fetch(`${url}/version`, {
          signal: AbortSignal.timeout(2000),
        })
        await response.body?.cancel()
        return response.ok
      } catch {
        return false
      }
    },
    Boolean
  )
}
function isolatedEnv(input) {
  const clean = { ...input }
  for (const key of CONVEX_ENV_KEYS) delete clean[key]
  for (const key of Object.keys(clean))
    if (
      key.startsWith("CONVEX_") ||
      key.startsWith("OPENSEND_") ||
      key.startsWith("COMPOSE_") ||
      key.endsWith("_IMAGE") ||
      [
        "INSTANCE_NAME",
        "INSTANCE_SECRET",
        "SITE_URL",
        "CONVEX_PORT",
        "CONVEX_SITE_PORT",
        "APP_PORT",
        "SES_CALLBACK_ORIGIN",
      ].includes(key)
    )
      delete clean[key]
  return { ...clean, ...testStackEnv, COMPOSE_PROJECT_NAME: project }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true
    activeChild?.kill("SIGTERM")
  })

try {
  mkdirSync(results, { recursive: true })
  env = guardedDockerEnv(results, isolatedEnv(process.env))
  await execute("docker", ["info"], { quiet: true })
  // Copy tracked sources only, preserving the current worktree's edits. No
  // local env files, build output, git metadata, or production credentials.
  const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  if (tracked.status !== 0)
    throw new Error("Cannot list tracked product sources")
  for (const file of tracked.stdout.split("\0").filter(Boolean)) {
    if (
      !/^(convex\/|lib\/|services\/call-gateway\/src\/|packages\/sdk\/src\/|package.json$|tsconfig.json$)/.test(
        file
      )
    )
      continue
    const target = join(staging, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(resolve(file), target)
  }
  // The SDK transport is a newly added source in this worktree, before commit.
  for (const file of [
    "packages/sdk/src/common/api-client.ts",
    "packages/sdk/src/convex.ts",
    "packages/sdk/package.json",
  ]) {
    const target = join(staging, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(resolve(file), target)
  }
  symlinkSync(resolve("node_modules"), join(staging, "node_modules"), "dir")
  writeFileSync(
    join(staging, "convex.json"),
    JSON.stringify({ functions: "convex" })
  )
  writeComponentFixtures(staging, {
    project,
    endpoint: `http://host.docker.internal:${exampleSitePort}/opensend/webhook`,
  })
  // The migrate image runs as uid 1000, which may differ from the Linux host
  // user. Codegen needs writable generated files in the disposable bind mount.
  prepareComponentMount(join(staging, "convex"))
  const local = existsSync(".env.docker")
    ? parse(readFileSync(".env.docker", "utf8"))
    : {}
  const baseConfig = readFileSync("compose.yaml", "utf8")
  const pinnedImage = baseConfig.match(/CONVEX_IMAGE:-([^}]+)/)?.[1]
  assert.ok(pinnedImage, "compose.yaml pins a Convex backend image")
  const image =
    process.env.E2E_CONVEX_IMAGE || local.CONVEX_IMAGE || pinnedImage
  let gateway
  if (process.platform === "linux") {
    gateway = await execute(
      "docker",
      [
        "network",
        "inspect",
        "bridge",
        "-f",
        "{{(index .IPAM.Config 0).Gateway}}",
      ],
      { capture: true }
    )
    assert.ok(gateway, "Docker bridge gateway is available")
  }
  const values = {
    COMPOSE_PROJECT_NAME: project,
    INSTANCE_NAME: project,
    INSTANCE_SECRET: instanceSecret,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SSO_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    SITE_URL: `http://localhost:${productSitePort}`,
    CONVEX_PORT: productPort,
    CONVEX_SITE_PORT: productSitePort,
    CONVEX_PUBLIC_URL: `http://localhost:${productPort}`,
    CONVEX_PUBLIC_SITE_URL: `http://host.docker.internal:${productSitePort}`,
    CONVEX_BACKEND_ORIGIN: `http://host.docker.internal:${productPort}`,
    CONVEX_IMAGE: image,
    MIGRATE_IMAGE: `${project}-migrate`,
    OPENSEND_BACKEND_ONLY: "1",
  }
  writeTestStackEnv(filename, values)
  writeFileSync(
    composeOverride,
    `services:
  convex:
${gateway ? `    ports:\n      - "${gateway}:${productPort}:3210"\n      - "${gateway}:${productSitePort}:3211"\n` : ""}  migrate:
    build:
      context: ${JSON.stringify(root)}
    volumes:
      - ${JSON.stringify(`${staging}/convex:/app/convex`)}
    extra_hosts:
      - "host.docker.internal:host-gateway"
  component-example:
    image: ${JSON.stringify(image)}
    stop_signal: SIGINT
    stop_grace_period: 20s
    ports:
      - "127.0.0.1:${examplePort}:3210"
      - "127.0.0.1:${exampleSitePort}:3211"
${gateway ? `      - "${gateway}:${exampleSitePort}:3211"\n` : ""}    environment:
      INSTANCE_NAME: ${project}-example
      INSTANCE_SECRET: ${exampleSecret}
      CONVEX_CLOUD_ORIGIN: http://127.0.0.1:3210
      CONVEX_SITE_ORIGIN: http://host.docker.internal:${exampleSitePort}
      DISABLE_BEACON: "true"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - component-example-data:/convex/data
volumes:
  component-example-data:
`,
    { mode: 0o600 }
  )
  compose = [
    "compose",
    "-f",
    resolve("compose.yaml"),
    "-f",
    composeOverride,
    "--env-file",
    filename,
    "-p",
    project,
  ]
  env = {
    ...env,
    OPENSEND_ENV_FILE: filename,
    OPENSEND_BACKEND_ONLY: "1",
    COMPOSE_FILE: `${resolve("compose.yaml")}:${composeOverride}`,
  }
  // setup.mjs generates its own admin key and deploys only this project's migrate.
  setupStarted = true
  await execute("node", ["scripts/setup.mjs"])
  const saved = parse(readFileSync(filename, "utf8"))
  env = {
    ...env,
    CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${productPort}`,
    CONVEX_SELF_HOSTED_ADMIN_KEY: saved.CONVEX_SELF_HOSTED_ADMIN_KEY,
  }
  await docker(["up", "-d", "component-example"])
  await ready(`http://127.0.0.1:${examplePort}`)
  const exampleKey = await execute(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "./generate_key",
      image,
      `${project}-example`,
      exampleSecret,
    ],
    { capture: true }
  )
  exampleEnv = {
    ...isolatedEnv(env),
    CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${examplePort}`,
    CONVEX_SELF_HOSTED_ADMIN_KEY: exampleKey,
    // Apply the consumer policy to later pnpm exec/run commands too, including
    // their automatic dependency checks. Environment/global strict defaults
    // must not undo the explicit install policy.
    pnpm_config_strict_dep_builds: "false",
    pnpm_config_ignore_scripts: "false",
    pnpm_config_dangerously_allow_all_builds: "false",
  }
  pass("isolated opensend and example backends")

  // Build against the disposable example backend, then install actual tarballs
  // outside the workspace. Override the SDK while its 0.1.2 is still unpublished.
  await execute("pnpm", ["--filter", "@opensendcc/sdk", "build"])
  await execute("pnpm", ["--filter", "@opensendcc/convex", "build"], {
    childEnv: exampleEnv,
  })
  const packs = join(temporary, "packs")
  mkdirSync(packs)
  await execute("pnpm", [
    "--filter",
    "@opensendcc/sdk",
    "pack",
    "--pack-destination",
    packs,
  ])
  await execute("pnpm", [
    "--filter",
    "@opensendcc/convex",
    "pack",
    "--pack-destination",
    packs,
  ])
  cpSync(resolve("packages/convex/example"), example, {
    recursive: true,
    filter: (path) => !path.includes("node_modules") && !path.includes(".env"),
  })
  const manifest = JSON.parse(
    readFileSync(join(example, "package.json"), "utf8")
  )
  const rootManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"))
  manifest.packageManager = rootManifest.packageManager
  // Workpool's runtime peer must match the pinned Convex version. Letting
  // pnpm choose the newest helper can require a newer Convex and fail strict
  // peer checks; declare the same compatible pair this checkout tests.
  manifest.dependencies["convex-helpers"] =
    rootManifest.dependencies["convex-helpers"]
  manifest.dependencies["@opensendcc/convex"] =
    `file:${join(packs, "opensendcc-convex-0.1.0.tgz")}`
  // pnpm 11 reads overrides from pnpm-workspace.yaml, not package.json.
  writeFileSync(
    join(example, "pnpm-workspace.yaml"),
    // Only the Convex CLI's esbuild needs an install script. The consumer
    // uses this checkout's linter, so it has no Next.js/native resolver tree.
    // Unknown optional scripts stay blocked without failing strict pnpm 11.
    "packages: []\nstrictDepBuilds: false\nallowBuilds:\n  esbuild: true\n  unrs-resolver: false\n  fsevents: false\noverrides:\n  '@opensendcc/sdk': " +
      JSON.stringify("file:" + join(packs, "opensendcc-sdk-0.1.2.tgz")) +
      "\n"
  )
  manifest.dependencies.convex = JSON.parse(
    readFileSync(resolve("node_modules/convex/package.json"), "utf8")
  ).version
  writeFileSync(
    join(example, "package.json"),
    JSON.stringify(manifest, null, 2)
  )
  // CLI flags override inherited CI/environment/global settings. A fresh
  // consumer has no lockfile, and optional blocked scripts must not be fatal.
  await execute(
    "pnpm",
    [
      "install",
      "--no-frozen-lockfile",
      "--config.strict-dep-builds=false",
      "--config.ignore-scripts=false",
      "--config.dangerously-allow-all-builds=false",
    ],
    {
      cwd: example,
      childEnv: exampleEnv,
    }
  )
  const installed = JSON.parse(
    readFileSync(
      join(example, "node_modules/@opensendcc/convex/package.json"),
      "utf8"
    )
  )
  assert.equal(
    installed.dependencies["@opensendcc/sdk"],
    "^0.1.2",
    "workspace dependency becomes a published range"
  )
  assert.deepEqual(
    Object.keys(installed.exports).sort(),
    [
      ".",
      "./convex.config.js",
      "./convex.config",
      "./_generated/component.js",
      "./_generated/component",
      "./test",
      "./package.json",
    ].sort()
  )
  await cli(["deploy", "--yes"], { cwd: example, childEnv: exampleEnv })
  await execute("pnpm", ["typecheck"], { cwd: example, childEnv: exampleEnv })
  // Resolve the executable/config from the checkout but lint from the consumer
  // cwd, so ESLint includes the temporary files rather than ignoring them as
  // outside its base path. No lint dependencies are added to the consumer.
  await execute(
    process.execPath,
    [
      resolve("node_modules/eslint/bin/eslint.js"),
      "--config",
      resolve("packages/convex/eslint.config.mjs"),
      "convex",
      "--max-warnings",
      "0",
    ],
    { cwd: example, childEnv: exampleEnv }
  )
  pass("tarball exports, installation, deployment, typecheck, lint")

  const fixture = await runProduct("componentFixture:seed", {
    apiKey,
    webhookSecret,
  })
  for (const [key, value] of Object.entries({
    OPENSEND_API_KEY: apiKey,
    OPENSEND_BASE_URL: `http://host.docker.internal:${productSitePort}`,
    OPENSEND_WEBHOOK_SECRET: webhookSecret,
  }))
    await cli(["env", "set", `${key}=${value}`], {
      cwd: example,
      childEnv: exampleEnv,
      quiet: true,
    })
  pass(
    "API key, verified domain, and webhook subscription seeded with e2e SES fixtures"
  )
  const send = {
    from: "sender@mail.example.test",
    to: "recipient@example.com",
    subject: "Component E2E",
    text: "Hello from the packaged component",
  }
  const id = await runExample("email:send", send)
  const accepted = await poll(
    "component accepted send",
    () => runExample("email:status", { id }),
    (row) => row?.opensendId && ["sent", "delivered"].includes(row.status)
  )
  assert.ok(accepted.opensendId)
  pass("component sent with opensendId through the real /emails API")
  assert.equal(await runExample("email:cancel", { id }), false)
  for (const [eventType, status] of [
    ["Delivery", "delivered"],
    ["Bounce", "bounced"],
  ]) {
    await runProduct("ses/state:ingest", {
      topicArn: fixture.topicArn,
      messageId: randomBytes(16).toString("hex"),
      message: JSON.stringify(
        sesFixtureNotification({
          eventType,
          emailId: accepted.opensendId,
          teamId: fixture.team,
          recipient: send.to,
          messageId: `ses-${accepted.opensendId}`,
        })
      ),
    })
    await poll(
      `${status} signed webhook`,
      () => runExample("email:status", { id }),
      (row) => row?.status === status
    )
    const events = await runExample("email:events", { id })
    assert.ok(
      events.some(
        (row) =>
          row.event.type === `email.${status}` &&
          row.event.opensendId === accepted.opensendId &&
          row.emailId === id
      )
    )
    pass(`${status} through real signed webhook and onEmailEvent`)
  }
  const bad = await runExample("email:send", {
    ...send,
    from: "sender@unverified.example.test",
  })
  const failed = await poll(
    "unverified sender failure",
    () => runExample("email:status", { id: bad }),
    (row) => row?.status === "failed"
  )
  assert.match(failed.errorMessage, /403/)
  pass("unverified sender 403 is recorded failed (the actual API contract)")
  const invalidAttachment = await runExample("email:send", {
    ...send,
    attachments: [{ filename: "invalid.txt", content: "%%%" }],
  })
  const invalid = await poll(
    "422 invalid attachment",
    () => runExample("email:status", { id: invalidAttachment }),
    (row) => row?.status === "failed"
  )
  assert.match(invalid.errorMessage, /422/)
  pass("invalid attachment 422 is recorded failed")
  const canceled = await runExample("email:sendAndCancel", {
    ...send,
    subject: "Cancel atomically",
  })
  assert.equal(
    (await runExample("email:status", { id: canceled })).status,
    "cancelled"
  )
  pass("queued cancellation and cancellation after acceptance")
  await runExample("email:cleanup", { olderThan: 0 })
  for (const deleted of [id, bad, invalidAttachment, canceled])
    await poll(
      "cleanup",
      () => runExample("email:status", { id: deleted }),
      (row) => row === null
    )
  pass("cleanup")
  exitStatus = 0
} catch (error) {
  console.error(`FAIL ${error.message}`)
  if (compose && env)
    await docker([
      "logs",
      "--tail",
      "80",
      "convex",
      "migrate",
      "component-example",
    ]).catch(() => {})
} finally {
  if (setupStarted && existsSync(filename)) {
    try {
      // Check both data volumes before the existing ownership-guarded cleanup.
      for (const name of ["convex-data", "component-example-data"]) {
        const inspect = spawnSync(
          "docker",
          [
            "volume",
            "inspect",
            `${project}_${name}`,
            "--format",
            '{{ index .Labels "com.docker.compose.project" }}',
          ],
          { env, encoding: "utf8" }
        )
        if (inspect.status === 0)
          assert.equal(
            inspect.stdout.trim(),
            project,
            "volume belongs to this run"
          )
      }
      removeTestInstance(filename, project, compose)
      pass("owned containers and volumes removed")
    } catch (error) {
      console.error(`FAIL teardown: ${error.message}`)
      exitStatus = 1
    }
  }
  // Temporary directories contain this run's test keys and installed tarballs.
  rmSync(temporary, { recursive: true, force: true })
  if (env && setupStarted) {
    const image = `${project}-migrate`
    // Only remove the unique image built by this run, never a shared image.
    spawnSync("docker", ["image", "rm", image], { env, stdio: "ignore" })
  }
  console.log(
    `${exitStatus === 0 ? "PASS" : "FAIL"} convex component harness (${JSON.stringify(ports)})`
  )
  process.exitCode = exitStatus
}
