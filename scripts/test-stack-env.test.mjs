import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { parse } from "./lib.mjs"
import { testStackEnv } from "./test-stack-env.mjs"

for (const existing of [false, true]) {
  test(`calling harness redirects telemetry in ${existing ? "reused" : "new"} env files and every Docker child`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "opensend-calling-env-"))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    mkdirSync(join(directory, "scripts"))
    for (const file of ["test-stack-env.mjs", "lib.mjs"])
      copyFileSync(resolve("scripts", file), join(directory, "scripts", file))
    const bin = join(directory, "bin")
    mkdirSync(bin)
    const callsFile = join(directory, "calls.jsonl")
    writeFileSync(
      join(bin, "docker"),
      `#!${process.execPath}
const { appendFileSync } = require("node:fs")
appendFileSync(process.env.TEST_CALLS_FILE, JSON.stringify({
  args: process.argv.slice(2),
  OPENSEND_TELEMETRY: process.env.OPENSEND_TELEMETRY,
  OPENSEND_TELEMETRY_URL: process.env.OPENSEND_TELEMETRY_URL,
}) + "\\n")
`,
      { mode: 0o700 }
    )
    // Simulate the lock boundary so tests never touch the shared media stack.
    for (const command of ["mkdir", "rmdir"])
      writeFileSync(
        join(bin, command),
        '#!/bin/sh\n[ "$1" = /private/tmp/opensend-calling-harness.lock ]\n',
        { mode: 0o700 }
      )
    const filename = join(directory, ".env.calling-test")
    if (existing) {
      writeFileSync(
        filename,
        "VOICE_AGENT_SECRET=fixture-saved-secret\n" +
          "CALL_GATEWAY_SECRET=fixture-gateway-secret\n" +
          "OPENSEND_TELEMETRY=0\n" +
          "OPENSEND_TELEMETRY_URL=https://opensend.cc/api/telemetry\n"
      )
      chmodSync(filename, 0o644)
    }
    const result = spawnSync(
      "sh",
      [resolve("scripts/test-calling-harness.sh"), "baseline"],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_CALLS_FILE: callsFile,
          OPENSEND_TELEMETRY: "0",
          OPENSEND_TELEMETRY_URL: "https://opensend.cc/api/telemetry",
        },
        encoding: "utf8",
        timeout: 20_000,
      }
    )
    assert.equal(result.status, 0, result.stderr)
    const saved = parse(readFileSync(filename, "utf8"))
    for (const [key, value] of Object.entries(testStackEnv))
      assert.equal(saved[key], value)
    assert.equal(statSync(filename).mode & 0o777, 0o600)
    if (existing) {
      assert.equal(saved.VOICE_AGENT_SECRET, "fixture-saved-secret")
      assert.equal(saved.CALL_GATEWAY_SECRET, "fixture-gateway-secret")
    } else {
      assert.match(saved.VOICE_AGENT_SECRET, /^[a-f0-9]{64}$/)
    }
    const calls = readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.equal(calls.length, 4)
    for (const call of calls)
      for (const [key, value] of Object.entries(testStackEnv))
        assert.equal(call[key], value)
    assert.ok(calls.some((call) => call.args.includes("up")))
    assert.ok(calls.some((call) => call.args.includes("run")))
  })
}
