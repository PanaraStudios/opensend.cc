import assert from "node:assert/strict"
import { test } from "node:test"
import { startFakeGraph } from "./fake-graph.mjs"
test("fake Graph serves authenticated media metadata and download bytes and records requests", async () => {
  const graph = await startFakeGraph(0)
  const headers = { authorization: "Bearer media-test" }
  try {
    const metadata = await (
      await fetch(`${graph.origin}/v25.0/meta-inbound-media`, { headers })
    ).json()
    assert.equal(metadata.mime_type, "image/png")
    assert.equal(metadata.file_size, 3)
    const file = await fetch(
      `${graph.origin}${new URL(metadata.url).pathname}`,
      { headers }
    )
    assert.equal(file.headers.get("content-type"), "image/png")
    assert.deepEqual(
      Array.from(new Uint8Array(await file.arrayBuffer())),
      [1, 2, 3]
    )
    const calls = await (await fetch(`${graph.origin}/__calls`)).json()
    assert.equal(calls.length, 2)
    assert.equal(calls[0].version, "v25.0")
    assert.equal(calls[1].path, "/media-download/meta-inbound-media")
    assert.ok(
      calls.every((call) => call.authorization === headers.authorization)
    )
    await fetch(`${graph.origin}/__responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "^/meta-inbound-media$",
        status: 500,
        body: { error: { code: 1 } },
      }),
    })
    assert.equal(
      (await fetch(`${graph.origin}/v25.0/meta-inbound-media`)).status,
      500
    )
    await fetch(`${graph.origin}/__reset`, { method: "POST" })
    assert.deepEqual(await (await fetch(`${graph.origin}/__calls`)).json(), [])
    assert.equal(
      (await fetch(`${graph.origin}/v25.0/meta-inbound-media`)).status,
      200
    )
  } finally {
    await graph.close()
  }
})

test("fake Graph sends unique wamids, uploads media, captures signed customer events and forces Graph errors", async () => {
  const graph = await startFakeGraph(0)
  try {
    const send = () =>
      fetch(`${graph.origin}/v25.0/123/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: "16505551234",
          type: "text",
          text: { body: "Hi" },
        }),
      })
    const first = await (await send()).json(),
      second = await (await send()).json()
    assert.match(first.messages[0].id, /^wamid\.\d+$/)
    assert.notEqual(first.messages[0].id, second.messages[0].id)
    const form = new FormData()
    form.append("messaging_product", "whatsapp")
    form.append(
      "file",
      new Blob([new Uint8Array([255, 0, 128])], { type: "image/png" }),
      "file.png"
    )
    assert.match(
      (
        await (
          await fetch(`${graph.origin}/v25.0/123/media`, {
            method: "POST",
            body: form,
          })
        ).json()
      ).id,
      /^meta-upload-/
    )
    await fetch(`${graph.origin}/__webhooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "message",
        "svix-signature": "v1,signature",
      },
      body: JSON.stringify({
        type: "whatsapp.message.sent",
        data: { id: "local-id" },
      }),
    })
    const calls = await (await fetch(`${graph.origin}/__calls`)).json()
    assert.equal(calls.length, 4)
    assert.equal(calls[2].path, "/123/media")
    assert.match(calls[2].body, /name="messaging_product"/)
    assert.equal(calls[3].body.type, "whatsapp.message.sent")
    assert.equal(calls[3].headers["svix-signature"], "v1,signature")
    await fetch(`${graph.origin}/__responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "POST",
        path: "^/123/messages$",
        status: 400,
        body: { error: { code: 131047 } },
      }),
    })
    const forced = await send()
    assert.equal(forced.status, 400)
    assert.equal((await forced.json()).error.code, 131047)
  } finally {
    await graph.close()
  }
})
