import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { freePort, parse } from "./lib.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const installer = resolve(root, "scripts/install.sh")
const project = `opensend-install-${Date.now()}-${randomBytes(3).toString("hex")}`
const temporary = mkdtempSync(resolve(tmpdir(), `${project}-`))
const directory = resolve(temporary, "installation")
const assets = resolve(temporary, "assets")
const tags = []
const logContainer = `${project}-logs`
const composeEnv = { ...process.env }
// Compose interpolates the calling shell before reading .env. Keep the test
// installation's saved images, ports and origins authoritative in every check.
for (const key of Object.keys(composeEnv))
  if (
    key.startsWith("OPENSEND_") ||
    key.startsWith("COMPOSE_") ||
    key.endsWith("_IMAGE") ||
    [
      "APP_PORT",
      "CONVEX_PORT",
      "CONVEX_SITE_PORT",
      "SITE_URL",
      "CONVEX_PUBLIC_URL",
      "CONVEX_PUBLIC_SITE_URL",
      "CONVEX_BACKEND_ORIGIN",
      "CONVEX_DEPLOY_KEY",
      "CONVEX_DEPLOYMENT",
      "CONVEX_SELF_HOSTED_URL",
      "CONVEX_SELF_HOSTED_ADMIN_KEY",
      "CONVEX_URL",
      "CONVEX_SITE_URL",
      "SES_CALLBACK_ORIGIN",
    ].includes(key)
  )
    delete composeEnv[key]
let server
let logs
let logText = ""

// Installer subprocesses must be asynchronous: they fetch from this process's
// HTTP server, which needs its event loop while the installer is running.
function execute(command, args, { input, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })
    if (input !== undefined) child.stdin.end(input)
    let output = ""
    child.stdout?.on("data", (chunk) => (output += chunk))
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(output.trim())
      else reject(new Error(`${command} ${args[0]} failed (${signal || code})`))
    })
  })
}
const composeArgs = ["compose", "--project-directory", directory, "-p", project]
const compose = (args, capture = false) =>
  execute("docker", [...composeArgs, ...args], {
    env: composeEnv,
    ...(capture ? { stdio: ["ignore", "pipe", "inherit"] } : {}),
  })
const settings = () => parse(readFileSync(resolve(directory, ".env"), "utf8"))
async function healthy() {
  const response = await fetch(`${settings().SITE_URL}/login`, {
    signal: AbortSignal.timeout(10_000),
  })
  await response.body?.cancel()
  assert.equal(response.status, 200, "/login is healthy")
  const ids = await compose(["ps", "-a", "-q", "migrate"], true)
  assert.ok(ids, "migrate container exists")
  const containers = JSON.parse(
    await execute("docker", ["inspect", ...ids.split(/\s+/)], {
      stdio: ["ignore", "pipe", "inherit"],
    })
  )
  const container = containers.find(
    (entry) =>
      entry.Config.Labels["com.docker.compose.oneoff"].toLowerCase() === "false"
  )
  assert.ok(container, "regular migrate container exists")
  assert.equal(container.State.Status, "exited")
  assert.equal(container.State.ExitCode, 0)
}
async function auth(path, data) {
  const base = settings().SITE_URL
  const response = await fetch(`${base}/api/auth${path}`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(body)}`)
  return body
}
async function verificationLink(email) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const line of logText.split("\n")) {
      try {
        const event = JSON.parse(line)
        for (const log of event.logLines || [])
          for (const text of log.messages || []) {
            const mail = JSON.parse(text.replace(/^'|'$/g, ""))
            if (
              mail.event === "auth.email" &&
              mail.to === email &&
              mail.subject.toLowerCase().includes("verify")
            )
              return mail.actionLink
          }
      } catch {
        // A stream may end with a partial JSON line.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("First-account verification link did not appear in logs")
}

try {
  for (const service of ["app", "migrate"])
    for (const version of ["itest-a", "itest-b"]) {
      const image = `opensend-${service}:${version}`
      assert.notEqual(
        spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" })
          .status,
        0,
        `Refusing to overwrite existing test image ${image}`
      )
    }
  for (const service of ["app", "migrate"]) {
    const image = `opensend-${service}:itest-a`
    await execute("docker", ["build", "--target", service, "-t", image, "."], {
      cwd: root,
    })
    tags.push(image)
    const upgradeImage = `opensend-${service}:itest-b`
    await execute("docker", ["tag", image, upgradeImage])
    tags.push(upgradeImage)
  }
  mkdirSync(assets)
  for (const file of [
    "compose.yaml",
    "compose.caddy.yaml",
    "docker/caddy/Caddyfile",
    "compose.cloud.yaml",
    "compose.cloud-caddy.yaml",
    "docker/caddy/Caddyfile.cloud",
  ])
    copyFileSync(resolve(root, file), resolve(assets, file.split("/").at(-1)))
  const assetNames = new Set([
    "/compose.yaml",
    "/compose.caddy.yaml",
    "/Caddyfile",
    "/compose.cloud.yaml",
    "/compose.cloud-caddy.yaml",
    "/Caddyfile.cloud",
  ])
  server = createServer((request, response) => {
    if (!assetNames.has(request.url)) {
      response.writeHead(404).end()
      return
    }
    response.end(readFileSync(resolve(assets, request.url.slice(1))))
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const source = `http://127.0.0.1:${server.address().port}`
  // Reserve distinct ports sequentially, avoiding concurrent freePort reuse.
  const ports = new Set()
  while (ports.size < 3) ports.add(await freePort())
  const [appPort, convexPort, sitePort] = [...ports]
  const env = {
    ...composeEnv,
    APP_PORT: appPort,
    CONVEX_PORT: convexPort,
    CONVEX_SITE_PORT: sitePort,
    COMPOSE_PROJECT_NAME: project,
  }
  const configuration = resolve(temporary, "configuration")
  await execute("sh", ["-s", "--", "install"], {
    input: readFileSync(installer),
    stdio: ["pipe", "inherit", "inherit"],
    env: {
      ...env,
      COMPOSE_PROJECT_NAME: `${project}-config`,
      OPENSEND_DIR: configuration,
      OPENSEND_DOMAIN: "mail.example.test",
      OPENSEND_YES: "1",
      OPENSEND_NO_START: "1",
      OPENSEND_VERSION: "itest-a",
      OPENSEND_SOURCE_URL: source,
    },
  })
  const configured = parse(readFileSync(resolve(configuration, ".env"), "utf8"))
  assert.equal(configured.COMPOSE_FILE, "compose.yaml:compose.caddy.yaml")
  assert.equal(configured.SITE_URL, "https://mail.example.test")
  assert.equal(
    configured.CONVEX_PUBLIC_URL,
    "https://realtime.mail.example.test"
  )
  assert.equal(configured.CONVEX_PUBLIC_SITE_URL, "https://api.mail.example.test")
  assert.equal(configured.CONVEX_BACKEND_ORIGIN, configured.CONVEX_PUBLIC_URL)
  assert.ok(statSync(resolve(configuration, "docker/caddy/Caddyfile")).isFile())

  // Fake credentials only: cloud dry runs must never start migrate or contact Convex.
  for (const useCaddy of [true, false]) {
    const cloudDirectory = resolve(temporary, useCaddy ? "cloud" : "cloud-eu")
    const cloudArgs = [
      "--dir",
      cloudDirectory,
      "--domain",
      "cloud.example.test",
      "--yes",
      "--no-start",
      "--version",
      "itest-a",
      "--source-url",
      source,
    ]
    await execute(
      "sh",
      [
        installer,
        "install",
        ...cloudArgs,
        "--convex",
        "cloud",
        "--deploy-key",
        "dev:fake-name|token",
        "--caddy",
        useCaddy ? "yes" : "no",
        ...(useCaddy
          ? []
          : [
              "--convex-url",
              "https://fake-name.eu.convex.cloud",
              "--convex-site-url",
              "https://fake-name.eu.convex.site",
            ]),
      ],
      { env: composeEnv }
    )
    const cloudSettings = () =>
      parse(readFileSync(resolve(cloudDirectory, ".env"), "utf8"))
    const initialCloud = cloudSettings()
    assert.equal(statSync(resolve(cloudDirectory, ".env")).mode & 0o777, 0o600)
    assert.equal(initialCloud.OPENSEND_CONVEX, "cloud")
    assert.equal(initialCloud.CONVEX_DEPLOY_KEY, "dev:fake-name|token")
    assert.equal(
      initialCloud.CONVEX_URL,
      useCaddy
        ? "https://fake-name.convex.cloud"
        : "https://fake-name.eu.convex.cloud"
    )
    assert.equal(
      initialCloud.CONVEX_SITE_URL,
      useCaddy
        ? "https://fake-name.convex.site"
        : "https://fake-name.eu.convex.site"
    )
    assert.equal(initialCloud.SES_CALLBACK_ORIGIN, initialCloud.CONVEX_SITE_URL)
    assert.equal(
      initialCloud.COMPOSE_FILE,
      "compose.yaml:compose.cloud.yaml" +
        (useCaddy ? ":compose.cloud-caddy.yaml" : "")
    )
    for (const key of [
      "INSTANCE_NAME",
      "INSTANCE_SECRET",
      "CONVEX_SELF_HOSTED_ADMIN_KEY",
      "CONVEX_PUBLIC_URL",
      "CONVEX_PUBLIC_SITE_URL",
    ])
      assert.equal(
        initialCloud[key],
        undefined,
        `${key} is not needed in cloud mode`
      )
    const cloudCompose = (args) =>
      execute(
        "docker",
        [
          "compose",
          "--project-directory",
          cloudDirectory,
          "-p",
          `${project}-cloud`,
          ...args,
        ],
        { env: composeEnv, stdio: ["ignore", "pipe", "inherit"] }
      )
    const config = JSON.parse(
      await cloudCompose(["--profile", "smtp", "config", "--format", "json"])
    )
    assert.equal(config.services.convex, undefined)
    assert.equal(config.services.migrate.depends_on, undefined)
    assert.equal(
      config.services.migrate.environment.CONVEX_SELF_HOSTED_URL,
      undefined
    )
    assert.equal(
      config.services.migrate.environment.CONVEX_SELF_HOSTED_ADMIN_KEY,
      undefined
    )
    assert.equal(
      config.services.migrate.environment.CONVEX_DEPLOY_KEY,
      initialCloud.CONVEX_DEPLOY_KEY
    )
    assert.deepEqual(Object.keys(config.services.app.depends_on), ["migrate"])
    assert.equal(
      config.services.app.environment.CONVEX_INTERNAL_URL,
      initialCloud.CONVEX_URL
    )
    assert.equal(
      config.services.app.environment.CONVEX_PUBLIC_URL,
      initialCloud.CONVEX_URL
    )
    assert.equal(
      config.services.app.environment.CONVEX_INTERNAL_SITE_URL,
      initialCloud.CONVEX_SITE_URL
    )
    assert.equal(
      config.services.smtp.environment.SMTP_CONVEX_SITE_URL,
      initialCloud.CONVEX_SITE_URL
    )
    assert.equal(config.services.smtp.depends_on, undefined)
    if (useCaddy) {
      assert.deepEqual(Object.keys(config.services.caddy.depends_on), ["app"])
      assert.equal(
        config.services.caddy.environment.CONVEX_SITE_URL,
        initialCloud.CONVEX_SITE_URL
      )
      assert.ok(
        statSync(
          resolve(cloudDirectory, "docker/caddy/Caddyfile.cloud")
        ).isFile()
      )
    }
    await execute(
      "sh",
      [
        installer,
        "install",
        ...cloudArgs,
        "--convex",
        "self",
        "--deploy-key",
        "prod:other|different",
      ],
      { env: composeEnv }
    )
    assert.deepEqual(
      cloudSettings(),
      initialCloud,
      "cloud rerun preserves configuration and deploy key"
    )
    await execute(
      "sh",
      [installer, "upgrade", ...cloudArgs, "--version", "itest-b"],
      { env: composeEnv }
    )
    assert.deepEqual(
      cloudSettings(),
      { ...initialCloud, OPENSEND_VERSION: "itest-b" },
      "upgrade remembers cloud mode and secrets"
    )
    await execute("sh", [installer, "uninstall", "--dir", cloudDirectory], {
      env: composeEnv,
    })
  }
  console.log(
    "PASS cloud dry configuration, regional URLs, rerun, upgrade and uninstall"
  )

  const install = (command, version) =>
    execute(
      "sh",
      [
        installer,
        command,
        "--dir",
        directory,
        "--local",
        "--caddy",
        "no",
        "--yes",
        "--version",
        version,
        "--source-url",
        source,
      ],
      {
        env: {
          ...env,
          APP_IMAGE: `opensend-app:${version}`,
          MIGRATE_IMAGE: `opensend-migrate:${version}`,
        },
        stdio: ["ignore", "inherit", "inherit"],
      }
    )
  await install("install", "itest-a")
  await healthy()
  const initial = settings()
  assert.equal(statSync(resolve(directory, ".env")).mode & 0o777, 0o600)
  assert.equal(initial.COMPOSE_PROJECT_NAME, project)
  assert.equal(
    initial.CONVEX_PUBLIC_SITE_URL,
    `http://host.docker.internal:${sitePort}`
  )
  assert.equal(
    initial.CONVEX_BACKEND_ORIGIN,
    `http://host.docker.internal:${convexPort}`
  )
  logs = spawn(
    "docker",
    [
      ...composeArgs,
      "run",
      "--rm",
      "--name",
      logContainer,
      "-T",
      "migrate",
      "logs",
      "--jsonl",
      "--history",
      "50",
    ],
    { env: composeEnv, stdio: ["ignore", "pipe", "inherit"] }
  )
  logs.stdout.on("data", (chunk) => (logText += chunk))
  const account = {
    name: "Installer Admin",
    email: "installer@example.test",
    password: "Installer-smoke-password-123",
  }
  await auth("/sign-up/email", {
    ...account,
    callbackURL: `${initial.SITE_URL}/login`,
  })
  const verification = await fetch(await verificationLink(account.email), {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  })
  await verification.body?.cancel()
  assert.equal(verification.status, 302)
  await auth("/sign-in/email", account)

  const before = Date.now()
  // Conflicting input must not change the installation on a re-run.
  await install("install", "itest-b")
  await healthy()
  assert.ok(
    Date.now() - before < 120_000,
    "re-install completes within two minutes"
  )
  assert.deepEqual(
    settings(),
    initial,
    "re-install preserves every environment value"
  )
  await install("upgrade", "itest-b")
  await healthy()
  const upgraded = settings()
  for (const key of [
    "INSTANCE_NAME",
    "INSTANCE_SECRET",
    "BETTER_AUTH_SECRET",
    "SSO_ENCRYPTION_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ])
    assert.equal(upgraded[key], initial[key], `${key} survives upgrade`)
  assert.equal(upgraded.OPENSEND_VERSION, "itest-b")
  assert.equal(upgraded.APP_IMAGE, "opensend-app:itest-b")
  assert.equal(upgraded.MIGRATE_IMAGE, "opensend-migrate:itest-b")
  assert.equal(
    (await auth("/sign-in/email", account)).user.email,
    account.email
  )
  console.log(
    "PASS installer, first-account signup, re-install, upgrade and persistent account"
  )
} finally {
  // Only this randomly named project and the tags created above are removed.
  spawnSync("docker", ["rm", "-f", logContainer], { stdio: "ignore" })
  logs?.kill("SIGTERM")
  let cleanupError
  try {
    if (
      spawnSync(
        "docker",
        ["compose", "--project-directory", directory, "-p", project, "config"],
        { env: composeEnv, stdio: "ignore" }
      ).status === 0
    )
      await compose(["down", "--volumes", "--remove-orphans"])
  } catch (error) {
    cleanupError = error
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    try {
      if (tags.length) await execute("docker", ["image", "rm", ...tags])
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
  if (cleanupError) throw cleanupError
}
