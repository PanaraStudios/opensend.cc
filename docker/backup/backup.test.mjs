import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
