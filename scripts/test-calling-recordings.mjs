// Run with the Convex image's Node binary and the production read-only mount.
import assert from "node:assert/strict"
import { createReadStream } from "node:fs"
import { readdir, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"

const root = "/recordings"
const files = (await readdir(root)).filter((name) =>
  /^[a-f0-9-]{36}\.wav$/i.test(name)
)
assert.ok(
  files.length,
  "The calling harness must produce a finalized recording"
)
for (const name of files) {
  const path = `${root}/${name}`
  const info = await stat(path)
  assert.equal(info.uid, 10002, "FreeSWITCH owns the recording")
  assert.ok(info.size > 44, "Recording has audio after the WAV header")
  let size = 0
  for await (const chunk of createReadStream(path)) size += chunk.length
  assert.equal(
    size,
    info.size,
    "Convex's Node user can stream the entire recording"
  )
}
const probe = `${root}/readonly-probe-${randomUUID()}`
let created = false
try {
  await assert.rejects(
    writeFile(probe, "probe").then(() => {
      created = true
    }),
    { code: "EROFS" }
  )
} finally {
  if (created) await unlink(probe)
}
console.log(
  `PASS recording handoff: Convex Node streamed ${files.length} WAVs; mount is read-only`
)
