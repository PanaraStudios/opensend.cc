import { test } from "node:test"
import assert from "node:assert/strict"
import { Window } from "happy-dom"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  findFormsWithoutSubmit,
  findVisibleRawCodes,
  RAW_CODE_FILENAME_PATTERN,
} from "./raw-code-policy.ts"

test("raw-code reporting excludes attachment filenames while retaining machine labels and variable paths", () => {
  for (const name of [
    "document.pdf",
    "image.png",
    "order_receipt.pdf",
    "photo.jpeg",
  ])
    assert.equal(RAW_CODE_FILENAME_PATTERN.test(name), true, name)
  for (const code of [
    "contact.first_name",
    "trigger.message.text",
    "snake_case",
    "event.field",
    "opensend_ig_e2e",
  ])
    assert.equal(RAW_CODE_FILENAME_PATTERN.test(code), false, code)
})

test("the browser detector skips filenames and @handles but still reports real variable tokens", async () => {
  const window = new Window()
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  )
  const previousFilter = Object.getOwnPropertyDescriptor(
    globalThis,
    "NodeFilter"
  )
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  })
  Object.defineProperty(globalThis, "NodeFilter", {
    configurable: true,
    value: window.NodeFilter,
  })
  try {
    window.document.body.innerHTML = `
      <p>document.pdf image.png order_receipt.pdf</p>
      <span>@opensend_ig_e2e</span>
      <span><span>@</span>opensend_ig_e2e</span>
      <p>contact.first_name trigger.message.text snake_case</p>
      <pre>payload_internal</pre>
      <p hidden>hidden_code</p>
      <p>https://example.test/path_code</p>
    `
    assert.deepEqual(findVisibleRawCodes(RAW_CODE_FILENAME_PATTERN), [
      "contact.first_name",
      "trigger.message.text",
      "snake_case",
    ])
  } finally {
    for (const [key, descriptor] of [
      ["document", previousDocument],
      ["NodeFilter", previousFilter],
    ]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    await window.happyDOM.close()
  }
})

test("every form has a submit button", () => {
  assert.deepEqual(
    findFormsWithoutSubmit(`<form onSubmit={save}>
      <Button>Save</Button>
    </form>
    <form onSubmit={save}>
      <Button type="submit">Save</Button>
    </form>
    <form id="edit" onSubmit={save}></form>
    <Button form="edit" type="submit">Save</Button>
    <form id={formId} onSubmit={save}></form>
    <Button form={formId} type="submit">Save</Button>
    <form id="orphan" onSubmit={save}></form>
    <form {...props} onSubmit={(event) => save(event)} />`),
    [1, 11]
  )
  const files = ["app", "components"].flatMap((dir) =>
    readdirSync(dir, { recursive: true })
      .filter((file) => /\.tsx$/.test(file))
      .map((file) => join(dir, file))
  )
  const offenders = files.flatMap((file) =>
    findFormsWithoutSubmit(readFileSync(file, "utf8")).map(
      (line) => `${file}:${line}`
    )
  )
  assert.deepEqual(offenders, [])
})
