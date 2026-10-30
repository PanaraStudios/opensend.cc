import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

/** A checkout copy with fake docker, unzip and gpg; gpg exits `gpgExit`. */
function fixture(t, gpgExit) {
  const root = mkdtempSync(join(tmpdir(), "opensend-prod-backup-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bin = join(root, "bin")
  const backups = join(root, "backups")
  for (const path of [bin, backups, join(root, "scripts")]) mkdirSync(path)
  copyFileSync(
    new URL("./prod-backup.sh", import.meta.url),
    join(root, "scripts/prod-backup.sh")
  )
  writeFileSync(join(root, ".env.docker"), "INSTANCE_SECRET=secret\n")
  const tools = {
    // `docker cp <container>:<path> <dest>` writes the export.
    docker: `[ "$1" = cp ] && echo zip >"$3"; exit 0`,
    unzip: "exit 0",
    gpg: `echo "$*" >"${join(root, "gpg-args")}"
while [ "$1" != --output ]; do shift; done
echo encrypted >"$2"
exit ${gpgExit}`,
  }
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const old = join(backups, "convex-export-20200101T000000Z.zip")
  writeFileSync(old, "old")
  utimesSync(old, new Date("2020-01-01"), new Date("2020-01-01"))
  const result = spawnSync("sh", [join(root, "scripts/prod-backup.sh")], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      BACKUP_GPG_RECIPIENT: "0123456789ABCDEF0123456789ABCDEF01234567",
      BACKUP_UPLOAD_COMMAND: `touch "${join(root, "uploaded")}"`,
    },
  })
  return {
    result,
    files: readdirSync(backups).sort(),
    gpgArgs: readFileSync(join(root, "gpg-args"), "utf8"),
    uploaded: existsSync(join(root, "uploaded")),
  }
}

test("a backup exports, encrypts the env without a trust check and uploads", (t) => {
  const f = fixture(t, 0)
  assert.equal(f.result.status, 0, f.result.stderr)
  assert.match(f.result.stdout, /prod-backup: ok/)
  assert.match(f.gpgArgs, /--trust-model always/)
  assert.equal(f.files.length, 2)
  assert.match(f.files[0], /^convex-export-\d{8}T\d{6}Z\.zip$/)
  assert.match(f.files[1], /^env-\d{8}T\d{6}Z\.gpg$/)
  assert.ok(f.uploaded)
})

test("failed encryption still prunes and uploads, cleans up and exits non-zero", (t) => {
  const f = fixture(t, 2)
  assert.notEqual(f.result.status, 0)
  assert.match(f.result.stderr, /encrypting .* FAILED/)
  assert.doesNotMatch(f.result.stdout, /prod-backup: ok/)
  // The old export is pruned, the new one kept, no partial file lingers.
  assert.equal(f.files.length, 1)
  assert.match(f.files[0], /^convex-export-\d{8}T\d{6}Z\.zip$/)
  assert.ok(f.uploaded)
})
