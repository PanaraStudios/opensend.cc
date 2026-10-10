import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  convexCliCommand,
  redactOutput,
  runCommand,
} from "../../scripts/convex-component-process.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

test("Convex CLI bypasses pnpm in a staging app with shared node_modules and no TTY", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "opensend-cli-symlink-"))
  try {
    const staging = join(temporary, "product")
    const bin = join(temporary, "bin")
    mkdirSync(staging)
    mkdirSync(bin)
    writeFileSync(
      join(staging, "package.json"),
      readFileSync(join(root, "package.json"))
    )
    symlinkSync(
      join(root, "node_modules"),
      join(staging, "node_modules"),
      "dir"
    )
    const marker = join(temporary, "pnpm-invoked")
    // A harmless sentinel catches package-manager invocations without risking
    // the shared dependency directory, even if this regression returns.
    const shim = join(bin, "pnpm")
    writeFileSync(
      shim,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe invocation'); process.exit(91)\n`
    )
    chmodSync(shim, 0o700)
    const modulesBefore = statSync(join(root, "node_modules"))
    const invocation = convexCliCommand(root, ["--version"])
    const version = await runCommand(invocation.command, invocation.args, {
      cwd: staging,
      childEnv: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CI: "true",
        pnpm_config_verify_deps_before_run: "install",
      },
      capture: true,
      quiet: true,
    })
    assert.equal(
      version,
      JSON.parse(readFileSync(join(root, "node_modules/convex/package.json")))
        .version
    )
    assert.equal(existsSync(marker), false)
    assert.equal(
      readlinkSync(join(staging, "node_modules")),
      join(root, "node_modules")
    )
    const modulesAfter = statSync(join(root, "node_modules"))
    assert.equal(modulesAfter.ino, modulesBefore.ino)
    assert.equal(modulesAfter.mtimeMs, modulesBefore.mtimeMs)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("failure includes stdout/stderr tails, redacts split credentials, and omits arguments", async () => {
  const apiKey = "os_process_test_key"
  const webhook = "whsec_process_test_signature=="
  const admin = 'admin-credential-with-quote"-and-newline\nsecret'
  const notLogged = "argument-must-never-appear"
  const script = `
    process.stdout.write('old-output'.repeat(1000) + '\\nERR_PNPM_TEST_FAILURE\\n' + ${JSON.stringify(apiKey)} + '\\n' + JSON.stringify(${JSON.stringify(admin)}));
    process.stderr.write('stderr diagnostic\\n' + ${JSON.stringify(webhook.slice(0, 12))});
    setTimeout(() => { process.stderr.write(${JSON.stringify(webhook.slice(12))}); process.exitCode = 1 }, 5);
  `
  await assert.rejects(
    runCommand(process.execPath, ["-e", script, notLogged], {
      label: "Convex CLI",
      quiet: true,
      capture: true,
      secrets: [apiKey, webhook],
      childEnv: { ...process.env, CONVEX_SELF_HOSTED_ADMIN_KEY: admin },
    }),
    (error) => {
      assert.match(error.message, /Convex CLI failed \(1\)/)
      assert.match(error.message, /stdout \(tail\):/)
      assert.match(error.message, /stderr \(tail\):/)
      assert.match(error.message, /ERR_PNPM_TEST_FAILURE/)
      assert.match(error.message, /stderr diagnostic/)
      assert.match(error.message, /\[REDACTED\]/)
      for (const secret of [
        apiKey,
        webhook,
        admin,
        JSON.stringify(admin).slice(1, -1),
        notLogged,
      ])
        assert.equal(error.message.includes(secret), false)
      assert.ok(error.message.length < 8400)
      assert.equal(error.message.includes("old-output".repeat(1000)), false)
      return true
    }
  )
})

test("captured JSON waits for complete stdout and is returned without redaction", async () => {
  const payload = {
    id: "email-test",
    content: "x".repeat(128 * 1024),
    apiKey: "os_captured_only",
  }
  const output = await runCommand(
    process.execPath,
    // Generate the large output in the child: Linux limits each argv string to
    // 128 KiB, independently of the total command size.
    [
      "-e",
      `process.stdout.write(JSON.stringify({ id: 'email-test', content: 'x'.repeat(128 * 1024), apiKey: 'os_captured_only' }))`,
    ],
    {
      capture: true,
      quiet: true,
    }
  )
  assert.deepEqual(JSON.parse(output), payload)
})

test("printed successful output is redacted on both streams", () => {
  const moduleUrl = pathToFileURL(
    join(root, "scripts/convex-component-process.mjs")
  ).href
  const secret = "test-instance-secret-success"
  const script = `
    import { runCommand } from ${JSON.stringify(moduleUrl)};
    await runCommand(process.execPath, ['-e', ${JSON.stringify(`process.stdout.write('${secret}'); process.stderr.write('${secret}')`)}], { secrets: [${JSON.stringify(secret)}] });
  `
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "[REDACTED]")
  assert.equal(result.stderr, "[REDACTED]")
})

test("redaction covers recognized tokens and credentials crossing tail boundaries", async () => {
  assert.equal(
    redactOutput("os_unregistered_key whsec_unregistered== Bearer other-token"),
    "[REDACTED] [REDACTED] Bearer [REDACTED]"
  )
  const secret = "secret-that-would-be-partly-truncated-unique-suffix"
  await assert.rejects(
    runCommand(
      process.execPath,
      [
        "-e",
        `process.stderr.write(${JSON.stringify(secret + "x".repeat(4090))}); process.exitCode = 1`,
      ],
      {
        secrets: [secret],
        quiet: true,
      }
    ),
    (error) => {
      assert.equal(error.message.includes("unique-suffix"), false)
      return true
    }
  )
})
