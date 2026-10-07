import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "opensend-coturn-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const config = join(dir, "turnserver.conf")
  const script = join(dir, "entrypoint.sh")
  // Isolate the private config from other tests/containers on this shared host.
  writeFileSync(
    script,
    readFileSync(
      new URL("../docker/coturn/entrypoint.sh", import.meta.url),
      "utf8"
    ).replaceAll("/tmp/turnserver.conf", config)
  )
  mkdirSync(join(dir, "bin"))
  writeFileSync(
    join(dir, "bin/turnserver"),
    '#!/bin/sh\n[ "$1" = -c ] && [ -r "$2" ]\n'
  )
  chmodSync(join(dir, "bin/turnserver"), 0o755)
  const secret = randomBytes(32).toString("hex")
  const env = { ...process.env }
  for (const key of Object.keys(env))
    if (key.startsWith("CALL_TURN_")) delete env[key]
  const run = (overrides = {}) =>
    spawnSync("sh", [script], {
      env: {
        ...env,
        PATH: `${join(dir, "bin")}:${env.PATH}`,
        CALL_TURN_SECRET: secret,
        CALL_TURN_PUBLIC_IP: "192.0.2.10",
        ...overrides,
      },
      encoding: "utf8",
    })
  return { dir, config, secret, run }
}

test("coturn REST config is private, preserves ports, denies private peers and never logs the secret", (t) => {
  const f = fixture(t)
  const result = f.run({
    CALL_TURN_PORT: "3479",
    CALL_TURN_RELAY_RANGE: "22800-22999",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal((result.stdout + result.stderr).includes(f.secret), false)
  assert.equal(statSync(f.config).mode & 0o777, 0o600)
  const config = readFileSync(f.config, "utf8")
  for (const line of [
    "use-auth-secret",
    `static-auth-secret=${f.secret}`,
    "realm=opensend-calling",
    "listening-port=3479",
    "min-port=22800",
    "max-port=22999",
    "no-multicast-peers",
    "no-tls",
    "no-dtls",
    "no-tcp-relay",
  ])
    assert.ok(config.split("\n").includes(line))
  assert.doesNotMatch(config, /^(user=|lt-cred-mech)/m)
  assert.equal(config.match(/^denied-peer-ip=/gm).length, 8)
  for (const range of [
    "10.0.0.0-10.255.255.255",
    "172.16.0.0-172.31.255.255",
    "192.168.0.0-192.168.255.255",
    "127.0.0.0-127.255.255.255",
    "169.254.0.0-169.254.255.255",
    "::1",
    "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  ])
    assert.ok(config.includes(`denied-peer-ip=${range}\n`))
})

test("coturn rejects invalid secrets, ranges, ports and realm without exposing values", (t) => {
  const f = fixture(t)
  for (const overrides of [
    { CALL_TURN_SECRET: "" },
    { CALL_TURN_SECRET: "short" },
    { CALL_TURN_SECRET: `${f.secret}\nno-auth` },
    { CALL_TURN_PUBLIC_IP: "" },
    { CALL_TURN_PUBLIC_IP: "invalid" },
    ...["0", "03478", "65536", "1", "port"].map((port) => ({
      CALL_TURN_PORT: port,
    })),
    ...["1-99", "22000-22000", "23000-22000", "22000-70000", "invalid"].map(
      (range) => ({ CALL_TURN_RELAY_RANGE: range })
    ),
    { CALL_TURN_REALM: "bad\nno-auth" },
    { CALL_TURN_CERT_FILE: "/missing/cert" },
  ]) {
    const result = f.run(overrides)
    assert.notEqual(result.status, 0)
    assert.equal((result.stdout + result.stderr).includes(f.secret), false)
  }
})

test("coturn enables TLS only with readable certificate/key and a valid distinct listener", (t) => {
  const f = fixture(t)
  const cert = join(f.dir, "cert.pem"),
    key = join(f.dir, "key.pem")
  // A stub server tests path validation/config generation, without a TLS handshake.
  writeFileSync(cert, "test certificate placeholder")
  writeFileSync(key, "test key placeholder")
  const settings = {
    CALL_TURN_CERT_FILE: cert,
    CALL_TURN_KEY_FILE: key,
    CALL_TURN_TLS_PORT: "5350",
  }
  assert.equal(f.run(settings).status, 0)
  const config = readFileSync(f.config, "utf8")
  assert.ok(
    config.includes(`tls-listening-port=5350\ncert=${cert}\npkey=${key}\n`)
  )
  assert.doesNotMatch(config, /^no-tls$/m)
  assert.notEqual(f.run({ ...settings, CALL_TURN_TLS_PORT: "3478" }).status, 0)
  assert.notEqual(f.run({ ...settings, CALL_TURN_TLS_PORT: "65536" }).status, 0)
})
