import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "./lib.mjs"
import { assertTestCompose, testProject } from "./test-compose.mjs"
import { configureTestStack, testStackEnv } from "./test-stack-env.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const secretKeys = [
  "INSTANCE_SECRET",
  "BETTER_AUTH_SECRET",
  "SSO_ENCRYPTION_KEY",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CALL_GATEWAY_SECRET",
  "JANUS_API_SECRET",
  "FREESWITCH_ESL_SECRET",
  "FREESWITCH_SIP_SECRET",
  "FREESWITCH_DIRECTORY_SECRET",
  "DRACHTIO_SECRET",
  "VOICE_AGENT_SECRET",
  "CALL_TURN_SECRET",
]

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "opensend-install-config-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const realDocker = spawnSync("sh", ["-c", "command -v docker"], {
    encoding: "utf8",
  }).stdout.trim()
  assert.ok(realDocker, "Docker CLI is needed for Compose configuration tests")
  const bin = join(dir, "bin")
  mkdirSync(bin)
  const log = join(dir, "commands.jsonl")
  // Simulate Docker operations only. Never save command arguments containing
  // credentials (generate_key) or resolved Compose environment values.
  writeFileSync(
    join(bin, "docker"),
    `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { assertTestCompose } from ${JSON.stringify(join(root, "scripts/test-compose.mjs"))}
const args = process.argv.slice(2)
assertTestCompose(args)
if (args.some(a => a.endsWith("generate_key"))) { console.log(process.env.TEST_ADMIN); process.exit(0) }
appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + "\\n")
const has = (...parts) => parts.every(p => args.includes(p))
if (has("version", "--short")) console.log(process.env.TEST_COMPOSE_VERSION || "2.39.0")
// Forward config to real Compose: service selection includes dependencies.
if (has("config")) {
  const result = spawnSync(process.env.TEST_REAL_DOCKER, args, { stdio: "inherit" })
  process.exit(result.status ?? 1)
}
if (has("ps", "convex") && process.env.TEST_NO_CONTAINER!=="1") console.log("test-convex-container")
if (has("ps", "migrate") && process.env.TEST_NO_CONTAINER!=="1" && process.env.TEST_NO_MIGRATE_CONTAINER!=="1") console.log("test-log-container\\ntest-migrate-container")
if (has("volume", "ls") && process.env.TEST_VOLUME==="1") console.log("original-project_convex-data")
if (args[0]==="inspect") {
  const format=args[args.indexOf("--format")+1]
  const container=args.at(-1)
  if (format.includes("Mounts")) console.log("original-project_convex-data")
  else if (format.includes("oneoff")) console.log(container==="test-log-container" ? "True" : "False")
  else console.log(container==="test-migrate-container" ? "test-migrate-image-id" : "test-image-id")
}
// Docker rejects a newline-separated list supplied as one image argument.
if (has("image", "inspect") && args.some(a => /[\\r\\n]/.test(a))) process.exit(8)
if (args[0]==="run" && has("--mount")) {
  if (process.env.TEST_FAIL==="backup") process.exit(7)
  const mount=args.find(a => a.startsWith("type=bind,src="))
  const path=mount.slice("type=bind,src=".length).split(",dst=")[0]
  writeFileSync(path+"/convex-data.tar.gz", "simulated archive")
}
if (has("export")) {
  if (process.env.TEST_FAIL==="backup") process.exit(7)
}
if (args[0]==="cp") writeFileSync(args.at(-1), "simulated export")
if (has("--exit-code-from") && process.env.TEST_FAIL==="migrate") process.exit(9)
if (has("pull") && process.env.TEST_FAIL==="pull") process.exit(8)
if (has("image", "inspect") && process.env.TEST_FAIL==="missing-image") process.exit(8)
`
  )
  chmodSync(join(bin, "docker"), 0o755)
  const assets = {
    "compose.yaml": "compose.yaml",
    "compose.caddy.yaml": "compose.caddy.yaml",
    "compose.cloud.yaml": "compose.cloud.yaml",
    "compose.cloud-caddy.yaml": "compose.cloud-caddy.yaml",
    Caddyfile: "docker/caddy/Caddyfile",
    "Caddyfile.cloud": "docker/caddy/Caddyfile.cloud",
  }
  let failAsset = false
  const server = createServer((req, res) => {
    const file = assets[req.url.slice(1)]
    if (!file || failAsset) return res.writeHead(404).end()
    res.end(readFileSync(join(root, file)))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const installation = join(dir, "instance")
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_ADMIN: randomBytes(32).toString("hex"),
    TEST_LOG: log,
    TEST_REAL_DOCKER: realDocker,
  }
  for (const key of Object.keys(env))
    if (
      /^(OPENSEND_|COMPOSE_|CONVEX_|CALL_|CALLING_|FREESWITCH_|JANUS_|DRACHTIO_|VOICE_AGENT_)/.test(
        key
      ) ||
      key.endsWith("_IMAGE") ||
      ["SITE_URL", "APP_PORT", "SES_CALLBACK_ORIGIN"].includes(key)
    )
      delete env[key]
  env.COMPOSE_PROJECT_NAME = testProject("install-config")
  const run = (args = [], extras = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "sh",
        [
          join(root, "scripts/install.sh"),
          ...(["install", "upgrade", "uninstall"].includes(args[0])
            ? [args[0]]
            : []),
          "--dir",
          installation,
          "--yes",
          ...(extras.TEST_PRODUCTION === "1" ? [] : ["--local"]),
          "--version",
          "itest-a",
          "--source-url",
          `http://127.0.0.1:${server.address().port}`,
          ...(["install", "upgrade", "uninstall"].includes(args[0])
            ? args.slice(1)
            : args),
        ],
        { env: { ...env, ...extras }, stdio: ["ignore", "pipe", "pipe"] }
      )
      let output = ""
      child.stdout.on("data", (c) => (output += c))
      child.stderr.on("data", (c) => (output += c))
      child.once("error", reject)
      child.once("exit", (code) => resolve({ code, output }))
    })
  const settings = () => parse(readFileSync(join(installation, ".env"), "utf8"))
  const commands = () =>
    readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  const clear = () => writeFileSync(log, "")
  const composeConfig = (profiles = []) => {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        installation,
        ...profiles.flatMap((p) => ["--profile", p]),
        "config",
        "--format",
        "json",
      ],
      { env: { ...env, PATH: process.env.PATH }, encoding: "utf8" }
    )
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  return {
    dir,
    installation,
    run,
    settings,
    commands,
    clear,
    composeConfig,
    failAssets: () => {
      failAsset = true
    },
  }
}

function privateOutput(result, env) {
  assert.equal(result.code, 0, result.output)
  for (const key of secretKeys)
    if (env[key])
      assert.ok(!result.output.includes(env[key]), `${key} must not be printed`)
}

test("fresh defaults use release images and leave calling off", async (t) => {
  const f = await fixture(t)
  const result = await f.run(["--no-start"])
  const env = f.settings()
  privateOutput(result, env)
  assert.equal(env.OPENSEND_CALLING, "no")
  assert.equal(env.CALL_GATEWAY_SECRET, undefined)
  const config = f.composeConfig()
  assert.equal(config.services.janus, undefined)
  assert.equal(config.services.coturn, undefined)
  assert.equal(
    config.services.app.image,
    "ghcr.io/panarastudios/opensend-app:itest-a"
  )
  f.clear()
  privateOutput(await f.run(["--no-start", "--version", "itest-b"]), env)
  assert.deepEqual(f.settings(), env)
  assert.ok(
    !f
      .commands()
      .some((c) => c.includes("pull") || c.includes("up") || c.includes("stop"))
  )
})

const callingFlags = [
  "--calling",
  "yes",
  "--calling-domain",
  "calling.example.test",
  "--calling-public-ip",
  "192.0.2.10",
  "--calling-wss-port",
  "8443",
  "--janus-rtp-range",
  "22000-22199",
  "--freeswitch-rtp-range",
  "22400-22799",
  "--turn",
  "yes",
  "--turn-port",
  "3479",
  "--turn-relay-range",
  "22800-22999",
]
test("calling and TURN flags reach Compose, services and backend, without starting media", async (t) => {
  const f = await fixture(t)
  const result = await f.run(["--no-start", ...callingFlags])
  const env = f.settings()
  privateOutput(result, env)
  assert.equal(env.COMPOSE_PROFILES, "calling,calling-turn")
  assert.equal(env.CALL_AGENT_WSS_URL, "wss://calling.example.test:8443")
  assert.equal(env.CALL_STUN_URLS, "stun:calling.example.test:3479")
  assert.equal(env.JANUS_PUBLIC_IP, "192.0.2.10")
  assert.equal(env.FREESWITCH_PUBLIC_IP, env.JANUS_PUBLIC_IP)
  for (const key of secretKeys) assert.match(env[key], /^[a-f0-9]{64}$/)
  const config = f.composeConfig()
  for (const name of [
    "janus",
    "freeswitch",
    "drachtio",
    "coturn",
    "call-gateway",
    "voice-agent",
  ])
    assert.equal(
      config.services[name].image,
      `ghcr.io/panarastudios/opensend-${name}:itest-a`
    )
  for (const key of [
    "CALL_GATEWAY_URL",
    "CALL_GATEWAY_SECRET",
    "CALL_AGENT_WSS_URL",
    "CALL_STUN_URLS",
  ])
    assert.equal(config.services.migrate.environment[key], env[key])
  assert.equal(config.services.janus.environment.JANUS_RTP_RANGE, "22000-22199")
  assert.equal(
    config.services.freeswitch.environment.FREESWITCH_RTP_RANGE,
    "22400-22799"
  )
  assert.equal(
    config.services.coturn.environment.CALL_TURN_RELAY_RANGE,
    "22800-22999"
  )
  for (const [name, target, published] of [
    ["janus", 22000, "22000"],
    ["freeswitch", 22400, "22400"],
    ["coturn", 3479, "3479"],
    ["coturn", 22800, "22800"],
  ])
    assert.ok(
      config.services[name].ports.some(
        (p) => p.target === target && p.published === published
      )
    )
  privateOutput(
    await f.run([
      "--no-start",
      "--calling-public-ip",
      "203.0.113.20",
      "--version",
      "itest-b",
    ]),
    env
  )
  assert.deepEqual(f.settings(), env)
  const upgrade = await f.run(
    ["--upgrade", "--no-start", "--version", "itest-b"],
    { JANUS_IMAGE: "test-janus:next" }
  )
  privateOutput(upgrade, f.settings())
  for (const key of secretKeys) assert.equal(f.settings()[key], env[key])
  assert.equal(f.settings().JANUS_IMAGE, "test-janus:next")
  assert.equal(f.composeConfig().services.janus.image, "test-janus:next")
})

test("v1 upgrade backs up the actual volume before pull/deploy/restart and retains secrets", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"], {
    MIGRATE_IMAGE: "test-migrate:old",
    COMPOSE_PROJECT_NAME: "old-project",
  })
  // A v1 environment has no v2 calling keys.
  const path = join(f.installation, ".env")
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(/^OPENSEND_(CALLING|TURN)=.*\n/gm, "")
  )
  const initial = f.settings()
  f.clear()
  const result = await f.run(["--upgrade", "--version", "itest-b"], {
    MIGRATE_IMAGE: "test-migrate:new",
    COMPOSE_PROJECT_NAME: "conflicting-project",
  })
  privateOutput(result, f.settings())
  for (const key of secretKeys.slice(0, 4))
    assert.equal(f.settings()[key], initial[key])
  assert.equal(f.settings().COMPOSE_PROJECT_NAME, initial.COMPOSE_PROJECT_NAME)
  assert.equal(f.settings().OPENSEND_VERSION, "itest-b")
  const calls = f.commands()
  const backup = calls.findIndex((c) => c.includes("--mount"))
  const pull = calls.findIndex((c) => c.includes("pull"))
  const deploy = calls.findIndex((c) => c.includes("--exit-code-from"))
  const backfill = calls.findIndex((c) =>
    c.includes("migrations:backfillCounts")
  )
  const restart = calls.findIndex(
    (c) => c.includes("up") && c.includes("--wait") && !c.includes("convex")
  )
  assert.ok(calls.findIndex((c) => c.includes("stop")) < backup)
  assert.ok(
    backup < pull && pull < deploy && deploy < backfill && backfill < restart
  )
  assert.ok(
    calls[backup].includes(
      "type=volume,src=original-project_convex-data,dst=/data,readonly"
    )
  )
  assert.ok(calls[backup].includes("test-migrate-image-id"))
  assert.ok(!calls.some((c) => c.includes("--volumes") || c.includes("down")))
  const backups = join(f.installation, "backups")
  const saved = join(backups, readdirSync(backups)[0])
  assert.ok(readFileSync(join(saved, "convex-data.tar.gz")).length)
  assert.deepEqual(parse(readFileSync(join(saved, "env"), "utf8")), initial)
})

test("backup failure preserves v1 configuration and prevents pull/deploy", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"])
  const initial = f.settings()
  f.clear()
  const result = await f.run(["--upgrade", "--version", "itest-b"], {
    TEST_FAIL: "backup",
  })
  assert.notEqual(result.code, 0)
  assert.match(result.output, /Volume backup failed/)
  assert.deepEqual(f.settings(), initial)
  assert.ok(
    !f
      .commands()
      .some((c) => c.includes("pull") || c.includes("--exit-code-from"))
  )
})

test("migration failure prevents app/media restart", async (t) => {
  const f = await fixture(t)
  const result = await f.run(callingFlags, { TEST_FAIL: "migrate" })
  assert.notEqual(result.code, 0)
  assert.ok(
    !f
      .commands()
      .some(
        (c) => c.includes("up") && c.includes("--wait") && !c.includes("convex")
      )
  )
})

test("calling can be added later without rotating secrets or losing existing profiles", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"])
  const env = f.settings()
  writeFileSync(
    join(f.installation, ".env"),
    readFileSync(join(f.installation, ".env"), "utf8") +
      "COMPOSE_PROFILES=debug,smtp\n"
  )
  const result = await f.run(["--no-start", ...callingFlags])
  privateOutput(result, f.settings())
  assert.equal(f.settings().COMPOSE_PROFILES, "debug,smtp,calling,calling-turn")
  for (const key of secretKeys.slice(0, 4))
    assert.equal(f.settings()[key], env[key])
})

test("invalid calling inputs fail before writing configuration", async (t) => {
  const f = await fixture(t)
  for (const extra of [
    ["--calling-public-ip", "999.0.2.1"],
    ["--calling-public-ip", ""],
    ["--calling-wss-port", "65536"],
    ["--janus-rtp-range", "23000-22000"],
    ["--janus-rtp-range", "22400-22600"],
    ["--janus-rtp-range", "20200-20399"],
    ["--turn-relay-range", "22000-22999"],
    ["--turn-port", "8443"],
    ["--calling-cert-dir", "relative"],
    ["--calling-domain", "bad/host"],
  ]) {
    assert.notEqual(
      (await f.run(["--no-start", ...callingFlags, ...extra])).code,
      0
    )
  }
  assert.notEqual((await f.run(["--no-start", "--turn", "yes"])).code, 0)
  const cloud = await f.run([
    "--no-start",
    "--convex",
    "cloud",
    "--deploy-key",
    randomBytes(32).toString("hex"),
    "--convex-url",
    "https://test.convex.cloud",
    "--convex-site-url",
    "https://test.convex.site",
    ...callingFlags,
  ])
  assert.match(cloud.output, /secured public gateway proxy/)
  assert.ok(!f.commands().some((c) => c.includes("generate_key")))
})

test("asset fetch failure leaves an existing stack and configuration untouched", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"])
  const initial = f.settings()
  f.clear()
  f.failAssets()
  assert.notEqual((await f.run(["--upgrade", "--version", "itest-b"])).code, 0)
  assert.deepEqual(f.settings(), initial)
  assert.ok(!f.commands().some((c) => c.includes("stop") || c.includes("pull")))
})

test("prepared install starts without a backup only when no data volume exists", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"])
  f.clear()
  const result = await f.run([], { TEST_NO_CONTAINER: "1" })
  privateOutput(result, f.settings())
  assert.match(result.output, /No existing Convex data volume/)
  assert.ok(!f.commands().some((c) => c.includes("--mount")))
  assert.ok(f.commands().some((c) => c.includes("--exit-code-from")))
})

test("upgrade after compose down finds and backs up the retained volume", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"])
  f.clear()
  const result = await f.run(["--upgrade"], {
    TEST_NO_CONTAINER: "1",
    TEST_VOLUME: "1",
  })
  privateOutput(result, f.settings())
  assert.ok(
    f
      .commands()
      .some((c) =>
        c.includes(
          "type=volume,src=original-project_convex-data,dst=/data,readonly"
        )
      )
  )
})

test("backup without a migrate container selects only its saved service image", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"], { MIGRATE_IMAGE: "test-migrate:old" })
  f.clear()
  privateOutput(
    await f.run(["--upgrade", "--version", "itest-b"], {
      TEST_NO_MIGRATE_CONTAINER: "1",
      MIGRATE_IMAGE: "test-migrate:new",
    }),
    f.settings()
  )
  const calls = f.commands()
  const backup = calls.find((c) => c.includes("--mount"))
  assert.ok(backup.includes("test-migrate:old"))
  assert.ok(!backup.includes("test-migrate:new"))
  assert.ok(!calls.some((c) => c.includes("--images") && c.includes("migrate")))
})

test("cloud upgrades export before deploy and abort on export failure", async (t) => {
  const f = await fixture(t)
  const flags = [
    "--convex",
    "cloud",
    "--deploy-key",
    randomBytes(32).toString("hex"),
    "--convex-url",
    "https://test.convex.cloud",
    "--convex-site-url",
    "https://test.convex.site",
  ]
  await f.run(["--no-start", ...flags])
  const initial = f.settings()
  f.clear()
  const failed = await f.run(["--upgrade", "--version", "itest-b"], {
    TEST_FAIL: "backup",
  })
  assert.notEqual(failed.code, 0)
  assert.deepEqual(f.settings(), initial)
  assert.ok(!f.commands().some((c) => c.includes("pull")))
  f.clear()
  const result = await f.run(["--upgrade", "--version", "itest-b"])
  privateOutput(result, f.settings())
  const calls = f.commands()
  assert.ok(
    calls.findIndex((c) => c.includes("export")) <
      calls.findIndex((c) => c.includes("pull"))
  )
  assert.ok(
    !calls.some(
      (c) => c.includes("--mount") || (c.includes("up") && c.includes("convex"))
    )
  )
})

test("release builds every Opensend Compose image for amd64 and arm64", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start"])
  const config = f.composeConfig(["smtp", "calling", "calling-turn"])
  const expected = Object.values(config.services)
    .flatMap((s) =>
      s.image.startsWith("ghcr.io/panarastudios/opensend-")
        ? [s.image.split("opensend-")[1].split(":")[0]]
        : []
    )
    .sort()
  const workflow = readFileSync(
    join(root, ".github/workflows/release.yml"),
    "utf8"
  )
  const matrices = [...workflow.matchAll(/image:\s*\[([^\]]+)\]/g)].map((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
  )
  assert.equal(matrices.length, 2)
  for (const images of matrices) assert.deepEqual(images, expected)
  assert.match(workflow, /platform: \[linux\/amd64, linux\/arm64\]/)
})

test("media entrypoints reject malformed port ranges before launching services", () => {
  for (const [service, key] of [
    ["janus", "JANUS_RTP_RANGE"],
    ["freeswitch", "FREESWITCH_RTP_RANGE"],
    ["coturn", "CALL_TURN_RELAY_RANGE"],
  ]) {
    for (const value of [
      "23000-22000",
      "1023-1100",
      "65534-65536",
      "20000-20100-20200",
      "20000",
    ]) {
      const result = spawnSync(
        "sh",
        [join(root, `docker/${service}/entrypoint.sh`)],
        { env: { ...process.env, [key]: value }, encoding: "utf8" }
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, new RegExp(`Invalid ${key}`))
    }
  }
})

test("old Compose versions fail before setup", async (t) => {
  const f = await fixture(t)
  const result = await f.run(["--no-start"], { TEST_COMPOSE_VERSION: "2.24.3" })
  assert.notEqual(result.code, 0)
  assert.match(result.output, /2\.24\.4 or newer/)
})

test("public calling needs a public IP and a certificate directory before startup", async (t) => {
  const f = await fixture(t)
  const extras = { TEST_PRODUCTION: "1" }
  const flags = [
    "--domain",
    "mail.example.test",
    "--caddy",
    "no",
    ...callingFlags,
  ]
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "100.64.0.1",
    "224.0.0.1",
  ]) {
    const result = await f.run(
      ["--no-start", ...flags, "--calling-public-ip", ip],
      extras
    )
    assert.notEqual(result.code, 0)
    assert.match(result.output, /public IPv4 address/)
  }
  assert.equal((await f.run(["--no-start", ...flags], extras)).code, 0)
  f.clear()
  const missing = await f.run([], extras)
  assert.notEqual(missing.code, 0)
  assert.match(missing.output, /trusted wss.pem/)
  assert.ok(!f.commands().some((c) => c.includes("stop") || c.includes("pull")))
  const certDir = join(f.dir, "certs")
  mkdirSync(certDir)
  writeFileSync(join(certDir, "wss.pem"), "simulated trusted certificate")
  privateOutput(
    await f.run(["--calling-cert-dir", certDir], extras),
    f.settings()
  )
  assert.equal(f.settings().FREESWITCH_CERT_DIR, certDir)
})

test("legacy TURN password migrates to a new REST secret, retained on upgrades", async (t) => {
  const f = await fixture(t)
  await f.run(["--no-start", ...callingFlags])
  const path = join(f.installation, ".env")
  const legacy = randomBytes(32).toString("hex")
  writeFileSync(
    path,
    readFileSync(path, "utf8")
      .replace(/^CALL_TURN_SECRET=.*$/m, `CALL_TURN_PASSWORD=${legacy}`)
      .replace(/^CALL_TURN_URLS=.*\n/m, "")
  )
  const migrated = await f.run([
    "--upgrade",
    "--no-start",
    "--version",
    "itest-b",
  ])
  const env = f.settings()
  privateOutput(migrated, env)
  assert.equal(migrated.output.includes(legacy), false)
  assert.equal(/^[a-f0-9]{64}$/.test(env.CALL_TURN_SECRET), true)
  assert.equal(env.CALL_TURN_SECRET === legacy, false)
  assert.equal(env.CALL_TURN_PASSWORD, undefined)
  assert.equal(
    env.CALL_TURN_URLS,
    "turn:calling.example.test:3479?transport=udp,turn:calling.example.test:3479?transport=tcp"
  )
  const config = f.composeConfig()
  assert.equal(
    config.services.coturn.environment.CALL_TURN_SECRET ===
      env.CALL_TURN_SECRET,
    true
  )
  assert.equal(
    config.services.migrate.environment.CALL_TURN_SECRET ===
      env.CALL_TURN_SECRET,
    true
  )
  assert.equal(config.services.app.environment.CALL_TURN_SECRET, undefined)
  assert.equal(config.services.coturn.environment.CALL_TURN_PASSWORD, undefined)
  await f.run(["--upgrade", "--no-start", "--version", "itest-c"])
  assert.equal(f.settings().CALL_TURN_SECRET === env.CALL_TURN_SECRET, true)
})

test("plain TURN keeps custom port 5349 without reserving an inactive TLS listener", async (t) => {
  const f = await fixture(t)
  privateOutput(
    await f.run(["--no-start", ...callingFlags, "--turn-port", "5349"]),
    f.settings()
  )
  assert.equal(f.settings().CALL_TURN_PORT, "5349")
  assert.equal(f.settings().CALL_STUN_URLS, "stun:calling.example.test:5349")
  const ports = f.composeConfig().services.coturn.ports
  assert.equal(
    ports.filter((p) => p.target === 5349 && p.protocol === "tcp").length,
    1
  )
})

test("TURN upgrade preserves an operator's STUN override", async (t) => {
  const f = await fixture(t)
  privateOutput(await f.run(["--no-start", ...callingFlags]), f.settings())
  const path = join(f.installation, ".env")
  const stun = "stun:operator.example.test:19302"
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /^CALL_STUN_URLS=.*$/m,
      `CALL_STUN_URLS=${stun}`
    )
  )
  privateOutput(
    await f.run(["--upgrade", "--no-start", "--version", "itest-b"]),
    f.settings()
  )
  assert.equal(f.settings().CALL_STUN_URLS, stun)
  assert.equal(
    f.composeConfig().services.migrate.environment.CALL_STUN_URLS,
    stun
  )
})

test("cloud scenario persists its isolated project through rerun, upgrade and uninstall", async (t) => {
  const f = await fixture(t)
  const args = [
    "--convex",
    "cloud",
    "--deploy-key",
    "dev:fake-name|token",
    "--domain",
    "cloud.example.test",
    "--no-start",
  ]
  privateOutput(await f.run(["install", ...args]), f.settings())
  const project = f.settings().COMPOSE_PROJECT_NAME
  assert.match(project, /^opensend-install-config-\d+-[a-f0-9]+$/)
  assert.equal(
    assertTestCompose(["compose", "down"], {}, f.installation),
    project
  )
  privateOutput(await f.run(["install", ...args]), f.settings())
  privateOutput(
    await f.run(["upgrade", ...args, "--version", "itest-b"]),
    f.settings()
  )
  assert.equal(f.settings().COMPOSE_PROJECT_NAME, project)
  // Uninstall clears the calling shell's Compose variables: the saved file
  // must still select the isolated project, even with a hostile shell value.
  privateOutput(
    await f.run(["uninstall"], { COMPOSE_PROJECT_NAME: "opensend" }),
    f.settings()
  )
  assert.equal(f.settings().COMPOSE_PROJECT_NAME, project)
  assert.ok(f.commands().some((args) => args.includes("down")))
})

test("fresh telemetry install prepares Compose before seeding env and preserves configuration", async (t) => {
  const f = await fixture(t)
  const filename = join(f.installation, ".env")
  await configureTestStack(filename, async () => {
    const result = await f.run(["--no-start"], testStackEnv)
    assert.equal(result.code, 0, result.output)
    assert.ok(
      !f
        .commands()
        .some(
          (args) =>
            args.includes("ps") || args.includes("up") || args.includes("stop")
        )
    )
  })
  const prepared = f.settings()
  assert.equal(prepared.OPENSEND_TELEMETRY, "1")
  assert.equal(prepared.OPENSEND_TELEMETRY_URL, "http://127.0.0.1:9/telemetry")
  assert.match(prepared.COMPOSE_PROJECT_NAME, /^opensend-install-config-/)
  const config = f.composeConfig()
  assert.equal(
    config.services.migrate.environment.OPENSEND_TELEMETRY_URL,
    testStackEnv.OPENSEND_TELEMETRY_URL
  )
  const result = await f.run([], { ...testStackEnv, TEST_NO_CONTAINER: "1" })
  assert.equal(result.code, 0, result.output)
  assert.match(
    result.output,
    /No existing Convex data volume; starting the prepared configuration/
  )
  assert.deepEqual(f.settings(), prepared)
  assert.ok(
    !f
      .commands()
      .some((args) => args.includes("--mount") || args.includes("stop"))
  )
})
