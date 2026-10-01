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

test("fake Graph sends unique wamids, uploads media and forces Graph errors", async () => {
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
    const calls = await (await fetch(`${graph.origin}/__calls`)).json()
    assert.equal(calls.length, 3)
    assert.equal(calls[2].path, "/123/media")
    assert.match(calls[2].body, /name="messaging_product"/)
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

test("fake Graph keeps message templates per WABA and lists a synced one", async () => {
  const graph = await startFakeGraph(0)
  const json = { "content-type": "application/json" }
  try {
    const created = await (
      await fetch(`${graph.origin}/v25.0/5551/message_templates`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          name: "order_update",
          language: "en_US",
          category: "UTILITY",
          parameter_format: "positional",
          components: [{ type: "BODY", text: "Hi" }],
        }),
      })
    ).json()
    assert.equal(created.status, "PENDING")
    const listed = await (
      await fetch(`${graph.origin}/v25.0/5551/message_templates`)
    ).json()
    assert.deepEqual(
      listed.data.map((template) => template.name),
      ["order_update", "e2e_synced_offer"]
    )
    assert.equal(listed.paging.next, undefined)
    const edited = await fetch(`${graph.origin}/v25.0/${created.id}`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ components: [{ type: "BODY", text: "Hello" }] }),
    })
    assert.equal(edited.status, 200)
    await fetch(
      `${graph.origin}/v25.0/5551/message_templates?name=order_update&hsm_id=${created.id}`,
      { method: "DELETE" }
    )
    const after = await (
      await fetch(`${graph.origin}/v25.0/5551/message_templates`)
    ).json()
    assert.deepEqual(
      after.data.map((template) => template.name),
      ["e2e_synced_offer"]
    )
  } finally {
    await graph.close()
  }
})

test("fake Graph exchanges Facebook Login codes, returns Page tokens and linked Instagram, subscribes and sends Page messages", async () => {
  const graph = await startFakeGraph(0)
  try {
    const get = async (path) =>
      (await fetch(`${graph.origin}/v25.0/${path}`)).json()
    const token = await get("oauth/access_token?code=facebook-code")
    assert.ok(token.access_token.includes("facebook-code"))
    const {
      data: [page],
    } = await get("me/accounts")
    assert.ok(page.access_token)
    assert.ok(page.instagram_business_account.id)
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${page.access_token}`,
    }
    const subscription = await fetch(
      `${graph.origin}/v25.0/${page.id}/subscribed_apps`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          subscribed_fields: "messages,messaging_postbacks",
        }),
      }
    )
    assert.equal((await subscription.json()).success, true)
    const sent = await fetch(`${graph.origin}/v25.0/${page.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        recipient: { id: "123" },
        messaging_type: "RESPONSE",
        message: { text: "Hi" },
      }),
    })
    assert.match((await sent.json()).message_id, /^mid\./)
    assert.equal(
      (await get("123?fields=first_name,last_name")).first_name,
      "Ada"
    )
    assert.equal(
      (await get("456?fields=name,username,profile_pic")).username,
      "grace_e2e"
    )
    const calls = await (await fetch(`${graph.origin}/__calls`)).json()
    assert.equal(
      calls.find((c) => c.path.endsWith("/messages")).authorization,
      headers.authorization
    )
  } finally {
    await graph.close()
  }
})

test("fake Graph accepts receipts and sender actions without allocating message ids", async () => {
  const graph = await startFakeGraph(0)
  try {
    for (const body of [
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: "wamid.inbound",
      },
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: "wamid.inbound",
        typing_indicator: { type: "text" },
      },
      ...["mark_seen", "typing_on", "typing_off"].map((sender_action) => ({
        recipient: { id: "scoped-user" },
        sender_action,
      })),
    ]) {
      const response = await fetch(`${graph.origin}/v25.0/123/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 200)
      assert.deepEqual(
        await response.json(),
        body.recipient ? { recipient_id: "scoped-user" } : { success: true }
      )
    }
    assert.equal(
      (await (await fetch(`${graph.origin}/__calls`)).json()).length,
      5
    )
  } finally {
    await graph.close()
  }
})
