import assert from "node:assert/strict"
import test from "node:test"
import { downloadFromUrl } from "./download"

test("streamed downloads load in a hidden frame, never in the app's own window", () => {
  const appended: unknown[] = []
  const frame = {
    style: { display: "" },
    src: "",
    removed: false,
    remove() {
      this.removed = true
    },
  }
  const created: string[] = []
  const doc = {
    createElement(tag: string) {
      created.push(tag)
      return frame
    },
    body: { appendChild: (node: unknown) => appended.push(node) },
  } as unknown as Pick<Document, "createElement" | "body">
  let cleanup: (() => void) | undefined
  let delay = 0
  downloadFromUrl(
    "https://site.test/exports/download/token",
    doc,
    (run, ms) => {
      cleanup = run
      delay = ms
    }
  )
  assert.deepEqual(created, ["iframe"])
  assert.deepEqual(appended, [frame])
  assert.equal(frame.src, "https://site.test/exports/download/token")
  assert.equal(frame.style.display, "none")
  assert.equal(frame.removed, false)
  assert.ok(delay >= 30_000)
  cleanup!()
  assert.equal(frame.removed, true)
})
