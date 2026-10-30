import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const script = new URL("./backup.sh", import.meta.url).pathname

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "opensend-backup-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, "backups")
  const bin = join(root, "bin")
  for (const path of [dir, bin]) mkdirSync(path)
  const run = (args, env = {}) =>
    spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        BACKUP_LOCAL_DIR: dir,
        PGDATABASE: "opensend",
        ...env,
      },
    })
  return { dir, bin, run }
}

test("status is healthy before the first dump is due and unhealthy after", (t) => {
  const f = fixture(t)
  assert.equal(f.run(["status"]).status, 1, "no loop and no dump")
  const now = Math.floor(Date.now() / 1000)
  writeFileSync(join(f.dir, ".loop-started"), `${now}\n`)
  assert.equal(f.run(["status"]).status, 0, "first dump not due yet")
  writeFileSync(join(f.dir, ".loop-started"), `${now - 300 - 24 * 3600 - 1}\n`)
  assert.equal(f.run(["status"]).status, 1, "first dump overdue")
  writeFileSync(join(f.dir, "convex-20261030T000000Z.dump"), "dump")
  assert.equal(f.run(["status"]).status, 0, "recent dump")
})

/** Fake pg_dump and pg_restore; each exits with the given code. */
function tools(f, { dump = 0, restore = 0 }) {
  writeFileSync(
    join(f.bin, "pg_dump"),
    `#!/bin/sh\nwhile [ "$1" != --file ]; do shift; done\necho dump >"$2"\nexit ${dump}\n`
  )
  writeFileSync(join(f.bin, "pg_restore"), `#!/bin/sh\nexit ${restore}\n`)
  for (const name of ["pg_dump", "pg_restore"])
    chmodSync(join(f.bin, name), 0o755)
}

function oldDump(f) {
  const path = join(f.dir, "convex-20200101T000000Z.dump")
  writeFileSync(path, "old")
  const old = new Date("2020-01-01")
  utimesSync(path, old, old)
}

const dumps = (f) => readdirSync(f.dir).sort()

test("a good dump is kept and old dumps are pruned", (t) => {
  const f = fixture(t)
  tools(f, {})
  oldDump(f)
  const result = f.run(["once"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /backup: ok/)
  const names = dumps(f)
  assert.equal(names.length, 1)
  assert.match(names[0], /^convex-\d{8}T\d{6}Z\.dump$/)
})

test("a dump pg_restore cannot read is discarded and nothing is pruned", (t) => {
  const f = fixture(t)
  tools(f, { restore: 1 })
  oldDump(f)
  const result = f.run(["once"])
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.stdout, /backup: ok/)
  assert.deepEqual(dumps(f), ["convex-20200101T000000Z.dump"])
})

test("a failed pg_dump leaves no partial file and prunes nothing", (t) => {
  const f = fixture(t)
  tools(f, { dump: 1 })
  oldDump(f)
  const result = f.run(["once"])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /pg_dump FAILED/)
  assert.deepEqual(dumps(f), ["convex-20200101T000000Z.dump"])
})
