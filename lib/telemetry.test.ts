import assert from "node:assert/strict"
import test from "node:test"
import {
  band,
  buildPayload,
  callingEnabled,
  emptyUsage,
  normalizeTelemetryVersion,
  telemetryEnabled,
  TELEMETRY_DAY,
  TELEMETRY_COUNT_FIELDS,
} from "./telemetry"

test("bands cover every threshold and cap counts", () => {
  for (const [count, expected] of [
    [0, "0"],
    [1, "1-9"],
    [9, "1-9"],
    [10, "10-99"],
    [99, "10-99"],
    [100, "100-999"],
    [999, "100-999"],
    [1000, "1k-9k"],
    [9999, "1k-9k"],
    [10000, "10k+"],
    [1e9, "10k+"],
  ] as const)
    assert.equal(band(count), expected)
})
test("environment hard off overrides the default and preference", () => {
  assert.equal(telemetryEnabled(undefined), true)
  assert.equal(telemetryEnabled("1", false), false)
  assert.equal(telemetryEnabled("0", true), false)
})
test("calling accepts numeric, installer and boolean forms regardless of case or whitespace", () => {
  for (const value of ["yes", "1", "true", "YES", " YeS ", " TRUE ", " 1 "])
    assert.equal(callingEnabled(value), true, JSON.stringify(value))
})
test("calling is off for missing, empty, negative and unrecognized values", () => {
  for (const value of ["no", "0", "", undefined, "false", "on", "2", " ", " NO "])
    assert.equal(callingEnabled(value), false, JSON.stringify(value))
})
test("payload explicitly projects schema 1 and supports v1 zero defaults", () => {
  const counts = emptyUsage()
  counts.teams = 56
  const payload = buildPayload({
    installationId: "18f5b149-bbd7-48e8-bc04-f2eaad4d0de7",
    now: 12 * TELEMETRY_DAY,
    installedAt: 0,
    version: "2.0.0-dev",
    deployment: {
      backend: "self-hosted",
      installMethod: "script",
      arch: "arm64",
      calling: false,
    },
    counts,
    sesProduction: null,
    smtpUsed30d: false,
    ssoEnabled: false,
  })
  assert.equal(payload.installedDays, 12)
  assert.equal(payload.usage.teams, "10-99")
  assert.equal(payload.usage.voiceBots, "0")
  assert.equal(payload.usage.sesProduction, null)
  assert.deepEqual(
    Object.keys(payload).sort(),
    [
      "schema",
      "installationId",
      "sentAt",
      "version",
      "deployment",
      "installedDays",
      "usage",
    ].sort()
  )
  assert.deepEqual(
    Object.keys(payload.usage).sort(),
    [
      ...TELEMETRY_COUNT_FIELDS,
      "sesProduction",
      "smtpUsed30d",
      "ssoEnabled",
    ].sort()
  )
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length < 8192)
})

test("versions normalize release tags and fall back to the baked release then unknown", () => {
  for (const [version, expected] of [
    ["v0.1.1", "0.1.1"],
    ["0.1.1", "0.1.1"],
    ["v2.0.0-rc.1", "2.0.0-rc.1"],
    ["1.2.3-rc.1+build.42", "1.2.3-rc.1+build.42"],
  ])
    assert.equal(normalizeTelemetryVersion(version, "v9.9.9"), expected)
  for (const version of [
    "latest",
    "",
    undefined,
    "junk",
    "vv0.1.1",
    "1.2.3-",
    `1.2.3+${"a".repeat(123)}`,
  ]) {
    assert.equal(
      normalizeTelemetryVersion(version, "v2.0.0-rc.1"),
      "2.0.0-rc.1"
    )
    assert.equal(normalizeTelemetryVersion(version), "0.0.0-unknown")
    assert.equal(normalizeTelemetryVersion(version, "latest"), "0.0.0-unknown")
  }
  assert.equal(
    normalizeTelemetryVersion(`1.2.3+${"a".repeat(122)}`),
    `1.2.3+${"a".repeat(122)}`
  )
})

test("payload version always satisfies the collector semver contract", () => {
  const collectorSemver =
    /^\d+\.\d+\.\d+(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/
  for (const version of [
    "v0.1.1",
    "0.1.1",
    "v2.0.0-rc.1",
    "latest",
    "",
    undefined,
    "junk",
    "vv0.1.1",
    `1.2.3+${"a".repeat(123)}`,
  ]) {
    for (const bakedVersion of [undefined, "v2.0.0-rc.1", "latest"]) {
      const payload = buildPayload({
        installationId: "18f5b149-bbd7-48e8-bc04-f2eaad4d0de7",
        now: TELEMETRY_DAY,
        installedAt: 0,
        version,
        bakedVersion,
        deployment: {
          backend: "self-hosted",
          installMethod: "script",
          arch: "arm64",
          calling: false,
        },
        counts: emptyUsage(),
        sesProduction: null,
        smtpUsed30d: false,
        ssoEnabled: false,
      })
      assert.match(payload.version, collectorSemver)
      assert.ok(payload.version.length <= 128)
    }
  }
})
