import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  productionDefaults,
  productionProblems,
  usesProductionOverlay,
} from "./prod-env.mjs"

const good = {
  COMPOSE_FILE: "compose.yaml:compose.prod.yaml:compose.caddy.yaml",
  POSTGRES_PASSWORD: "a".repeat(48),
  SITE_URL: "https://mail.example.com",
  CONVEX_PUBLIC_URL: "https://realtime.example.com",
  CONVEX_PUBLIC_SITE_URL: "https://api.example.com",
}

test("overlay detection and generated secrets", () => {
  assert.equal(usesProductionOverlay({ COMPOSE_FILE: "compose.yaml" }), false)
  assert.deepEqual(productionDefaults({}), {})
  assert.match(productionDefaults(good).POSTGRES_PASSWORD, /^[0-9a-f]{48}$/)
})

test("production env validation", () => {
  assert.deepEqual(productionProblems(good), [])
  assert.deepEqual(productionProblems({ SITE_URL: "http://x" }), [])
  const bad = productionProblems({
    ...good,
    POSTGRES_PASSWORD: "p@ss/word",
    SITE_URL: "http://localhost:3000",
    LOG_AUTH_LINKS: "true",
    INSTANCE_NAME: "my-team",
  })
  assert.equal(bad.length, 4)
})

test("compose.prod.yaml keeps Postgres private and secrets in env", () => {
  const text = readFileSync(
    new URL("../compose.prod.yaml", import.meta.url),
    "utf8"
  )
  const service = (name) =>
    text.match(
      new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|^volumes:)`, "m")
    )?.[1]
  const pg = service("postgres")
  assert.ok(pg, "postgres service")
  assert.doesNotMatch(pg, /^\s+ports:/m, "postgres must not publish a port")
  assert.match(pg, /image: \$\{POSTGRES_IMAGE:-postgres:\d+\.\d+/)
  assert.match(pg, /restart: unless-stopped/)
  assert.match(pg, /healthcheck:/)
  assert.match(pg, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/)
  assert.match(service("convex"), /condition: service_healthy/)
  assert.match(service("convex"), /POSTGRES_URL: .*@postgres:5432$/m)
  assert.doesNotMatch(text, /POSTGRES_PASSWORD:-/, "no default password")
  for (const name of [
    "postgres",
    "convex",
    "migrate",
    "app",
    "backup",
    "smtp",
    "call-gateway",
  ])
    assert.match(service(name), /logging: \*logging/, `${name} log rotation`)
})

test("compose.prod-s3.yaml never sets an optional S3 setting to an empty string", () => {
  const text = readFileSync(
    new URL("../compose.prod-s3.yaml", import.meta.url),
    "utf8"
  )
  const settings = text.split("\n").filter((line) => /^ {6}\w+:/.test(line))
  assert.ok(settings.length >= 8)
  // Convex reads a set-but-empty S3_ENDPOINT_URL as the endpoint.
  for (const line of settings) assert.doesNotMatch(line, /:-\}/, line)
  assert.doesNotMatch(text, /^\s+S3_ENDPOINT_URL:/m)
  assert.doesNotMatch(text, /^\s+AWS_S3_FORCE_PATH_STYLE:/m)
})
